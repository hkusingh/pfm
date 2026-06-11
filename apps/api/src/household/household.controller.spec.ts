/**
 * E1 Household & Membership — integration tests (Tier B)
 * Uses the real pfm_test Postgres database.
 * Tests run against a full NestJS app via supertest.
 * Data is cleaned from the test tables before each test via deleteMany.
 */
// Must be first — NestJS decorators require reflect-metadata to be loaded before module evaluation
import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { randomBytes } from 'crypto';
import * as argon2 from 'argon2';
import { SignJWT } from 'jose';
import { prisma } from '@pfm/db';
import { HouseholdModule } from './household.module';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TokenService } from '../auth/token.service';

process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret-minimum-32-chars-long';

const secret = new TextEncoder().encode(
  process.env.JWT_ACCESS_SECRET ?? 'test-secret-minimum-32-chars-long',
);

async function makeToken(userId: string, email: string) {
  return new SignJWT({ sub: userId, email, mfaVerified: true })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secret);
}

async function createUser(overrides: { email?: string; name?: string } = {}) {
  return prisma.user.create({
    data: {
      email: overrides.email ?? `user-${randomBytes(6).toString('hex')}@test.com`,
      name: overrides.name ?? 'Test User',
      passwordHash: await argon2.hash('password123456'),
      emailVerifiedAt: new Date(),
    },
  });
}

describe('Household API (E1)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      // Use only HouseholdModule + EmailModule — not AuthModule, which registers APP_GUARD with
      // a guard instance that lacks Reflector in the Nest test DI context.
      // TokenService is provided directly so the JWT guard can verify tokens.
      imports: [EmailModule, HouseholdModule],
      providers: [TokenService],
    })
      // Stub out real email sends — Resend rejects unverified domains in test environments
      .overrideProvider(EmailService)
      .useValue({ sendHouseholdInvite: vi.fn().mockResolvedValue(undefined) })
      .compile();

    app = module.createNestApplication();
    const reflector = module.get(Reflector);
    const tokens = module.get(TokenService);
    app.useGlobalGuards(new JwtAuthGuard(reflector, tokens));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    // Clean test data in FK-safe order
    await prisma.auditLog.deleteMany();
    await prisma.invite.deleteMany();
    await prisma.membership.deleteMany();
    await prisma.account.deleteMany();
    await prisma.household.deleteMany();
    await prisma.trustedDevice.deleteMany();
    await prisma.session.deleteMany();
    await prisma.mfaMethod.deleteMany();
    await prisma.recoveryCode.deleteMany();
    await prisma.signupInvite.deleteMany();
    await prisma.user.deleteMany();
  });

  // ─── E1.1 Create household ──────────────────────────────────────────────────

  describe('POST /households', () => {
    it('creates a household and sets the caller as primary owner', async () => {
      const user = await createUser();
      const token = await makeToken(user.id, user.email);

      const res = await request(app.getHttpServer())
        .post('/households')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Smith Family', baseCurrency: 'USD', monthStartDay: 1 })
        .expect(201);

      expect(res.body.data).toMatchObject({
        name: 'Smith Family',
        baseCurrency: 'USD',
        monthStartDay: 1,
      });

      const membership = await prisma.membership.findFirst({
        where: { userId: user.id },
      });
      expect(membership?.role).toBe('owner');
      expect(membership?.isPrimaryOwner).toBe(true);
    });

    it('rejects duplicate household creation', async () => {
      const user = await createUser();
      const token = await makeToken(user.id, user.email);

      await request(app.getHttpServer())
        .post('/households')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'First', baseCurrency: 'USD', monthStartDay: 1 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/households')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Second', baseCurrency: 'USD', monthStartDay: 1 })
        .expect(409);
    });

    it('rejects invalid currency', async () => {
      const user = await createUser();
      const token = await makeToken(user.id, user.email);

      // ZodValidationPipe returns 422 for schema errors
      await request(app.getHttpServer())
        .post('/households')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Family', baseCurrency: 'CAD', monthStartDay: 1 })
        .expect(422);
    });
  });

  // ─── E1.5 Household settings ─────────────────────────────────────────────────

  describe('GET /households/me', () => {
    it('returns the current user household', async () => {
      const user = await createUser();
      const token = await makeToken(user.id, user.email);

      const household = await prisma.household.create({
        data: { name: 'My House', baseCurrency: 'EUR', monthStartDay: 15 },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: user.id, role: 'owner', isPrimaryOwner: true },
      });

      const res = await request(app.getHttpServer())
        .get('/households/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body.data).toMatchObject({ name: 'My House', baseCurrency: 'EUR' });
    });

    it('returns 404 when user has no household', async () => {
      const user = await createUser();
      const token = await makeToken(user.id, user.email);

      await request(app.getHttpServer())
        .get('/households/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('PATCH /households/:id', () => {
    it('owner can update household settings', async () => {
      const user = await createUser();
      const token = await makeToken(user.id, user.email);
      const household = await prisma.household.create({
        data: { name: 'Old Name', baseCurrency: 'USD', monthStartDay: 1 },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: user.id, role: 'owner', isPrimaryOwner: true },
      });

      const res = await request(app.getHttpServer())
        .patch(`/households/${household.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'New Name' })
        .expect(200);

      expect(res.body.data.name).toBe('New Name');
    });

    it('member cannot update household settings', async () => {
      const owner = await createUser();
      const member = await createUser();
      const memberToken = await makeToken(member.id, member.email);
      const household = await prisma.household.create({
        data: { name: 'Family', baseCurrency: 'USD', monthStartDay: 1 },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: owner.id, role: 'owner', isPrimaryOwner: true },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: member.id, role: 'member', isPrimaryOwner: false },
      });

      await request(app.getHttpServer())
        .patch(`/households/${household.id}`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ name: 'Hacked Name' })
        .expect(403);
    });
  });

  // ─── E1.2 Invite member ───────────────────────────────────────────────────────

  describe('POST /households/:id/invites', () => {
    it('owner can invite a new member', async () => {
      const owner = await createUser();
      const token = await makeToken(owner.id, owner.email);
      const household = await prisma.household.create({
        data: { name: 'Family', baseCurrency: 'USD', monthStartDay: 1 },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: owner.id, role: 'owner', isPrimaryOwner: true },
      });

      const res = await request(app.getHttpServer())
        .post(`/households/${household.id}/invites`)
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'invitee@test.com', role: 'member' })
        .expect(201);

      expect(res.body.data).toMatchObject({ email: 'invitee@test.com', role: 'member', status: 'pending' });
    });

    it('rejects invite for an existing member', async () => {
      const owner = await createUser();
      const existing = await createUser({ email: 'existing@test.com' });
      const token = await makeToken(owner.id, owner.email);
      const household = await prisma.household.create({
        data: { name: 'Family', baseCurrency: 'USD', monthStartDay: 1 },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: owner.id, role: 'owner', isPrimaryOwner: true },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: existing.id, role: 'member', isPrimaryOwner: false },
      });

      await request(app.getHttpServer())
        .post(`/households/${household.id}/invites`)
        .set('Authorization', `Bearer ${token}`)
        .send({ email: 'existing@test.com', role: 'member' })
        .expect(409);
    });

    it('non-owner cannot send invites', async () => {
      const owner = await createUser();
      const member = await createUser();
      const memberToken = await makeToken(member.id, member.email);
      const household = await prisma.household.create({
        data: { name: 'Family', baseCurrency: 'USD', monthStartDay: 1 },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: owner.id, role: 'owner', isPrimaryOwner: true },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: member.id, role: 'member', isPrimaryOwner: false },
      });

      await request(app.getHttpServer())
        .post(`/households/${household.id}/invites`)
        .set('Authorization', `Bearer ${memberToken}`)
        .send({ email: 'someone@test.com', role: 'member' })
        .expect(403);
    });
  });

  // ─── E1.3 Accept invite ───────────────────────────────────────────────────────

  describe('POST /invites/:token/accept', () => {
    it('existing user can accept a valid invite', async () => {
      const owner = await createUser();
      const invitee = await createUser({ email: 'invitee@test.com' });
      const inviteeToken = await makeToken(invitee.id, invitee.email);
      const household = await prisma.household.create({
        data: { name: 'Family', baseCurrency: 'USD', monthStartDay: 1 },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: owner.id, role: 'owner', isPrimaryOwner: true },
      });
      const invite = await prisma.invite.create({
        data: {
          householdId: household.id,
          email: 'invitee@test.com',
          role: 'member',
          token: randomBytes(32).toString('hex'),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          invitedByUserId: owner.id,
        },
      });

      const res = await request(app.getHttpServer())
        .post(`/invites/${invite.token}/accept`)
        .set('Authorization', `Bearer ${inviteeToken}`)
        .expect(200);

      expect(res.body.data.id).toBe(household.id);

      const membership = await prisma.membership.findFirst({
        where: { userId: invitee.id, householdId: household.id },
      });
      expect(membership?.role).toBe('member');
      expect(membership?.isPrimaryOwner).toBe(false);
    });

    it('rejects accept when email does not match', async () => {
      const owner = await createUser();
      const wrongUser = await createUser({ email: 'wrong@test.com' });
      const wrongToken = await makeToken(wrongUser.id, wrongUser.email);
      const household = await prisma.household.create({
        data: { name: 'Family', baseCurrency: 'USD', monthStartDay: 1 },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: owner.id, role: 'owner', isPrimaryOwner: true },
      });
      const invite = await prisma.invite.create({
        data: {
          householdId: household.id,
          email: 'rightperson@test.com',
          role: 'member',
          token: randomBytes(32).toString('hex'),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          invitedByUserId: owner.id,
        },
      });

      await request(app.getHttpServer())
        .post(`/invites/${invite.token}/accept`)
        .set('Authorization', `Bearer ${wrongToken}`)
        .expect(403);
    });
  });

  // ─── E1.4 Manage roles & remove member ───────────────────────────────────────

  describe('PATCH /households/:id/members/:userId (role change)', () => {
    it('owner can promote a member to co-owner', async () => {
      const owner = await createUser();
      const member = await createUser();
      const ownerToken = await makeToken(owner.id, owner.email);
      const household = await prisma.household.create({
        data: { name: 'Family', baseCurrency: 'USD', monthStartDay: 1 },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: owner.id, role: 'owner', isPrimaryOwner: true },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: member.id, role: 'member', isPrimaryOwner: false },
      });

      await request(app.getHttpServer())
        .patch(`/households/${household.id}/members/${member.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ role: 'owner' })
        .expect(200);

      const updated = await prisma.membership.findFirst({ where: { userId: member.id } });
      expect(updated?.role).toBe('owner');
    });

    it('cannot demote the primary owner', async () => {
      const owner = await createUser();
      const coOwner = await createUser();
      const coOwnerToken = await makeToken(coOwner.id, coOwner.email);
      const household = await prisma.household.create({
        data: { name: 'Family', baseCurrency: 'USD', monthStartDay: 1 },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: owner.id, role: 'owner', isPrimaryOwner: true },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: coOwner.id, role: 'owner', isPrimaryOwner: false },
      });

      // co-owner tries to demote primary owner
      await request(app.getHttpServer())
        .patch(`/households/${household.id}/members/${owner.id}`)
        .set('Authorization', `Bearer ${coOwnerToken}`)
        .send({ role: 'member' })
        .expect(400);
    });
  });

  describe('DELETE /households/:id/members/:userId (remove)', () => {
    it('owner can remove a non-primary member', async () => {
      const owner = await createUser();
      const member = await createUser();
      const ownerToken = await makeToken(owner.id, owner.email);
      const household = await prisma.household.create({
        data: { name: 'Family', baseCurrency: 'USD', monthStartDay: 1 },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: owner.id, role: 'owner', isPrimaryOwner: true },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: member.id, role: 'member', isPrimaryOwner: false },
      });

      await request(app.getHttpServer())
        .delete(`/households/${household.id}/members/${member.id}`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200);

      const m = await prisma.membership.findFirst({ where: { userId: member.id } });
      expect(m?.status).toBe('removed');
    });

    it('cannot remove the primary owner', async () => {
      const owner = await createUser();
      const coOwner = await createUser();
      const coOwnerToken = await makeToken(coOwner.id, coOwner.email);
      const household = await prisma.household.create({
        data: { name: 'Family', baseCurrency: 'USD', monthStartDay: 1 },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: owner.id, role: 'owner', isPrimaryOwner: true },
      });
      await prisma.membership.create({
        data: { householdId: household.id, userId: coOwner.id, role: 'owner', isPrimaryOwner: false },
      });

      await request(app.getHttpServer())
        .delete(`/households/${household.id}/members/${owner.id}`)
        .set('Authorization', `Bearer ${coOwnerToken}`)
        .expect(400);
    });
  });
});
