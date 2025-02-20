import * as gcp from '@pulumi/gcp';
import * as k8s from '@pulumi/kubernetes';
import { Input, Output } from '@pulumi/pulumi';
import {
  addLabelsToWorkers,
  config,
  convertRecordToContainerEnvVars, createAutoscaledApplication,
  createAutoscaledExposedApplication,
  createK8sServiceAccountFromGCPServiceAccount,
  createKubernetesSecretFromRecord,
  createMigrationJob,
  createServiceAccountAndGrantRoles,
  createSubscriptionsFromWorkers,
  deployDebeziumToKubernetes, getFullSubscriptionLabel,
  getImageTag,
  getMemoryAndCpuMetrics, getPubSubUndeliveredMessagesMetric,
  k8sServiceAccountToIdentity,
  location,
} from '@dailydotdev/pulumi-common';
import { readFile } from 'fs/promises';
const workers = require('./workers');

const imageTag = getImageTag();
const name = 'gateway';
const debeziumTopicName = `${name}.changes`;

const debeziumTopic = new gcp.pubsub.Topic('debezium-topic', {
  name: debeziumTopicName,
});

// Provision Redis (Memorystore)
const redis = new gcp.redis.Instance(`${name}-redis`, {
  name: `${name}-redis`,
  tier: 'STANDARD_HA',
  memorySizeGb: 3,
  region: location,
  authEnabled: true,
  redisVersion: 'REDIS_6_X',
});

export const redisHost = redis.host;

const { serviceAccount } = createServiceAccountAndGrantRoles(
  `${name}-sa`,
  name,
  `daily-${name}`,
  [
    { name: 'profiler', role: 'roles/cloudprofiler.agent' },
    { name: 'trace', role: 'roles/cloudtrace.agent' },
    { name: 'secret', role: 'roles/secretmanager.secretAccessor' },
    { name: 'pubsub', role: 'roles/pubsub.editor' },
  ],
);

const image = `gcr.io/daily-ops/daily-${name}:${imageTag}`;

// Create K8S service account and assign it to a GCP service account
const { namespace } = config.requireObject<{ namespace: string }>('k8s');

const k8sServiceAccount = createK8sServiceAccountFromGCPServiceAccount(
  `${name}-k8s-sa`,
  name,
  namespace,
  serviceAccount,
);

new gcp.serviceaccount.IAMBinding(`${name}-k8s-iam-binding`, {
  role: 'roles/iam.workloadIdentityUser',
  serviceAccountId: serviceAccount.id,
  members: [k8sServiceAccountToIdentity(k8sServiceAccount)],
});

const envVars: Record<string, Input<string>> = {
  ...config.requireObject<Record<string, string>>('env'),
  redisHost,
  redisPass: redis.authString,
  redisPort: redis.port.apply((port) => port.toString()),
};

const containerEnvVars = convertRecordToContainerEnvVars({ secretName: name, data: envVars });

createKubernetesSecretFromRecord({
  data: envVars,
  resourceName: 'k8s-secret',
  name,
  namespace,
});

const migrationJob = createMigrationJob(
  `${name}-migration`,
  namespace,
  image,
  ['yarn', 'run', 'db:migrate:latest'],
  containerEnvVars,
  k8sServiceAccount,
);

const limits: Input<{
  [key: string]: Input<string>;
}> = {
  cpu: '1',
  memory: '512Mi',
};

const topics = ['features-reset'].map(
  (topic) => new gcp.pubsub.Topic(topic, { name: topic }),
);

createSubscriptionsFromWorkers(
  name,
  addLabelsToWorkers(workers, { app: name }),
  { dependsOn: [debeziumTopic, ...topics] },
);

const probe: k8s.types.input.core.v1.Probe = {
  httpGet: { path: '/health', port: 'http' },
  initialDelaySeconds: 5,
};

createAutoscaledExposedApplication({
  name,
  namespace: namespace,
  version: imageTag,
  serviceAccount: k8sServiceAccount,
  containers: [
    {
      name: 'app',
      image,
      ports: [{ name: 'http', containerPort: 3000, protocol: 'TCP' }],
      readinessProbe: probe,
      livenessProbe: probe,
      env: containerEnvVars,
      resources: {
        requests: limits,
        limits,
      },
    },
  ],
  maxReplicas: 10,
  metrics: getMemoryAndCpuMetrics(),
  deploymentDependsOn: [migrationJob],
});

const bgLimits: Input<{
  [key: string]: Input<string>;
}> = { cpu: '1', memory: '256Mi' };

createAutoscaledApplication({
  resourcePrefix: 'bg-',
  name: `${name}-bg`,
  namespace,
  version: imageTag,
  serviceAccount: k8sServiceAccount,
  containers: [
    {
      name: 'app',
      image,
      env: [
        ...containerEnvVars,
        { name: 'MODE', value: 'background' },
      ],
      resources: {
        requests: bgLimits,
        limits: bgLimits,
      },
    },
  ],
  minReplicas: 1,
  maxReplicas: 10,
  metrics: [
    {
      external: {
        metric: {
          name: getPubSubUndeliveredMessagesMetric(),
          selector: {
            matchLabels: {
              [getFullSubscriptionLabel('app')]: name,
            },
          },
        },
        target: {
          type: 'Value',
          averageValue: '20',
        },
      },
      type: 'External',
    },
  ],
  deploymentDependsOn: [migrationJob],
});

const getDebeziumProps = async (): Promise<string> => {
  return (await readFile('./application.properties', 'utf-8'))
    .replace('%database_pass%', config.require('debeziumDbPass'))
    .replace('%database_user%', config.require('debeziumDbUser'))
    .replace('%database_dbname%', envVars.mysqlDatabase as string)
    .replace('%hostname%', envVars.mysqlHost as string)
    .replace('%topic%', debeziumTopicName);
};

deployDebeziumToKubernetes(
  name,
  namespace,
  debeziumTopic,
  Output.create(getDebeziumProps()),
  `${location}-f`,
  { diskType: 'pd-ssd', diskSize: 100, image: 'debezium/server:1.6' },
);
