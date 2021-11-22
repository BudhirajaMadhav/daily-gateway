import slackNotification from './slackNotification';
import updateMailingList from './updateMailingList';
import updateReputation from './updateReputation';
import updateReferralContest from './updateReferralContest';
import eligibleParticipantNotification from './eligibleParticipantNotification';
import eligibleParticipantBoostChances from './eligibleParticipantBoostChances';
import cdc from './cdc';
import clearFeaturesCache from './clearFeaturesCache';
import updateAlerts from './updateAlerts';
import deleteUserFromMailingList from './deleteUserFromMailingList';

const workers = [
  slackNotification,
  updateMailingList,
  updateReputation,
  updateReferralContest,
  eligibleParticipantNotification,
  eligibleParticipantBoostChances,
  cdc,
  clearFeaturesCache,
  updateAlerts,
  deleteUserFromMailingList,
];

export default workers;
