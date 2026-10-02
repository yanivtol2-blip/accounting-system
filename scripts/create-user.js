// Creates a user from the command line. The first office user is created this way;
// after that, office staff add users from the app.
//
//   npm run create-user -- --email you@office.co.il --name "יניב" --role staff
//   npm run create-user -- --email client@biz.co.il --name "דנה" --role client --client "דנה עיצובים בע\"מ"
//
// The password is read from the PASSWORD environment variable, or asked for.
import readline from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { hashPassword, validatePassword } from '../src/auth.js';
import { createClient } from '../src/books.js';
import { audit, openDb } from '../src/db.js';

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'staff' },
    client: { type: 'string' },
    'tax-id': { type: 'string' },
  },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

const email = (values.email || '').trim().toLowerCase();
const name = (values.name || '').trim();
const role = values.role;
if (!email || !name) fail('Usage: --email <email> --name <name> [--role staff|client] [--client "<client file name>"]');
if (!['staff', 'client'].includes(role)) fail('--role must be staff or client');
if (role === 'client' && !values.client) fail('A client user needs --client "<client file name>"');

let password = process.env.PASSWORD;
if (!password) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('Password (8+ characters): ');
  rl.close();
}
try {
  validatePassword(password);
} catch (err) {
  fail(err.message);
}

const db = openDb();
if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) fail(`A user with ${email} already exists`);

let clientId = null;
if (role === 'client') {
  const existing = db.prepare('SELECT id FROM clients WHERE name = ?').get(values.client.trim());
  clientId = existing ? existing.id : createClient(db, { name: values.client.trim(), taxId: values['tax-id'] || null }, null);
  if (!existing) console.log(`Created client file "${values.client.trim()}" (#${clientId})`);
}

const { lastInsertRowid } = db
  .prepare('INSERT INTO users (email, name, password_hash, role, client_id) VALUES (?, ?, ?, ?, ?)')
  .run(email, name, hashPassword(password), role, clientId);
audit(db, { clientId, action: 'user.created', entityType: 'user', entityId: Number(lastInsertRowid), details: { email, role, via: 'cli' } });
console.log(`Created ${role} user ${email} (#${lastInsertRowid})`);
