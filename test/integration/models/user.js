import { expect } from 'chai';
import knexCleaner from 'knex-cleaner';
import db, { migrate } from '../../../src/db';
import user from '../../../src/models/user';
import fixture from '../../fixtures/users';

describe('user model', () => {
  beforeEach(async () => {
    await knexCleaner.clean(db, { ignoreTables: ['knex_migrations', 'knex_migrations_lock'] });
    return migrate();
  });

  it('should add new user to db', async () => {
    const model = await user.add(
      fixture[0].id,
      fixture[0].name,
      fixture[0].email,
      fixture[0].image,
    );

    expect(model).to.deep.equal({ ...fixture[0], referral: null });
  });

  it('should add new user to db with just an id', async () => {
    const model = await user.add(fixture[1].id);

    expect(model).to.deep.equal({ ...fixture[1], referral: null });
  });

  it('should fetch user by id', async () => {
    await user.add(
      fixture[0].id,
      fixture[0].name,
      fixture[0].email,
      fixture[0].image,
    );
    const model = await user.getById(fixture[0].id);
    delete model.createdAt;
    expect(model).to.deep.equal({
      ...fixture[0],
      infoConfirmed: false,
      premium: false,
      acceptedMarketing: true,
      reputation: 1,
      referralLink: 'https://api.daily.dev/get?r=1',
    });
  });

  it('should update user', async () => {
    await user.add(fixture[2].id);
    await user.update(fixture[2].id, fixture[2]);
    const model = await user.getById(fixture[2].id);
    delete model.createdAt;
    expect(model).to.deep.equal({
      ...fixture[2],
      infoConfirmed: false,
      premium: false,
      acceptedMarketing: true,
      reputation: 1,
      referralLink: 'https://api.daily.dev/get?r=3',
    });
  });

  it('should update users timezone', async () => {
    await user.add(fixture[3].id);
    await user.update(fixture[3].id, fixture[3]);
    const model = await user.getById(fixture[3].id);
    delete model.createdAt;
    expect(model).to.deep.equal({
      ...fixture[3],
      infoConfirmed: false,
      premium: false,
      acceptedMarketing: true,
      reputation: 1,
      referralLink: 'https://api.daily.dev/get?r=4',
      timezone: 'Pacific/Midway',
    });
  });

  it('should update user reputation', async () => {
    await user.add(fixture[2].id);
    await user.updateReputation(fixture[2].id, 2);
    const model = await db
      .select('reputation')
      .from('users')
      .where('id', '=', fixture[2].id)
      .limit(1);
    expect(model[0].reputation).to.deep.equal(2);
  });
});
