import assert from 'node:assert/strict';

const projectId = process.env.GCLOUD_PROJECT || 'demo-chitieu-rules';
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;

if (!firestoreHost) {
  throw new Error('Run this script with the Firestore emulator.');
}

const firestoreBase = `http://${firestoreHost}/v1/projects/${projectId}/databases/(default)`;

function stringValue(value) {
  return { stringValue: value };
}

function integerValue(value) {
  return { integerValue: String(value) };
}

function nullValue() {
  return { nullValue: null };
}

function emulatorToken(uid) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'none', typ: 'JWT' });
  const payload = encode({
    aud: projectId,
    auth_time: now,
    exp: now + 3600,
    firebase: { identities: {}, sign_in_provider: 'custom' },
    iat: now,
    iss: `https://securetoken.google.com/${projectId}`,
    sub: uid,
    user_id: uid,
  });
  return `${header}.${payload}.`;
}

async function commitDocument(token, path, fields) {
  return fetch(`${firestoreBase}/documents:commit`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      writes: [{
        update: {
          name: `projects/${projectId}/databases/(default)/documents/${path}`,
          fields,
        },
        updateTransforms: [{ fieldPath: 'serverUpdatedAt', setToServerValue: 'REQUEST_TIME' }],
      }],
    }),
  });
}

async function readDocument(token, path) {
  return fetch(`${firestoreBase}/documents/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
}

function baseFields(id) {
  return {
    id: stringValue(id),
    updatedAt: stringValue('2026-10-04T12:00:00'),
    deletedAt: nullValue(),
    deleted: { booleanValue: false },
    revision: integerValue(1),
    deviceId: stringValue('rules-test-device'),
    schemaVersion: integerValue(1),
  };
}

const owner = { uid: 'owner_rules_test', token: emulatorToken('owner_rules_test') };
const stranger = { uid: 'stranger_rules_test', token: emulatorToken('stranger_rules_test') };
const accountId = 'account_rules_test';
const transactionId = 'transaction_rules_test';
const accountPath = `users/${owner.uid}/accounts/${accountId}`;
const transactionPath = `users/${owner.uid}/transactions/${transactionId}`;

const accountFields = {
  ...baseFields(accountId),
  name: stringValue('Ví kiểm thử'),
  type: stringValue('cash'),
  bankCode: nullValue(),
  maskedIdentifier: nullValue(),
  currency: stringValue('VND'),
  openingBalance: integerValue(100000),
  openingBalanceDate: stringValue('2026-10-01'),
  archivedAt: nullValue(),
  displayOrder: integerValue(0),
  createdAt: stringValue('2026-10-04T12:00:00'),
};

const transactionFields = {
  ...baseFields(transactionId),
  type: stringValue('transfer'),
  amount: integerValue(250000),
  currency: stringValue('VND'),
  categoryId: stringValue('cat_other'),
  description: stringValue('Chuyển tiền kiểm thử'),
  occurredAt: stringValue('2026-10-04T12:00:00'),
  createdAt: stringValue('2026-10-04T12:00:00'),
  source: stringValue('manual'),
  fingerprint: nullValue(),
  accountId: stringValue(accountId),
  transferAccountId: stringValue('account_destination'),
  transferFee: integerValue(1000),
  recurringRuleId: stringValue('rule_monthly'),
  occurrenceKey: stringValue('recurring:rule_monthly:2026-10-04'),
};

let response = await commitDocument(owner.token, accountPath, accountFields);
assert.equal(response.status, 200, `owner account write: ${await response.text()}`);

response = await commitDocument(stranger.token, accountPath, accountFields);
assert.equal(response.status, 403, `cross-user account write unexpectedly returned ${response.status}`);

response = await readDocument(owner.token, accountPath);
assert.equal(response.status, 200, `owner account read: ${await response.text()}`);

response = await readDocument(stranger.token, accountPath);
assert.equal(response.status, 403, `cross-user account read unexpectedly returned ${response.status}`);

response = await commitDocument(owner.token, transactionPath, transactionFields);
assert.equal(response.status, 200, `owner transaction write: ${await response.text()}`);

response = await commitDocument(stranger.token, transactionPath, transactionFields);
assert.equal(response.status, 403, `cross-user transaction write unexpectedly returned ${response.status}`);

response = await readDocument(owner.token, transactionPath);
assert.equal(response.status, 200, `owner transaction read: ${await response.text()}`);

response = await readDocument(stranger.token, transactionPath);
assert.equal(response.status, 403, `cross-user transaction read unexpectedly returned ${response.status}`);

console.log('Firestore rules emulator: 8 owner/cross-user assertions passed.');
