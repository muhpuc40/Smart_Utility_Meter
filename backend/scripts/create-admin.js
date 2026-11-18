// Creates the first admin account.
// Usage: npm run create-admin -- "Admin Name" admin@example.com password123

import { supabase } from '../src/config/supabase.js';
import { hashPassword } from '../src/utils/security.js';

const [name, email, password] = process.argv.slice(2);

if (!name || !email || !password) {
  console.log('Usage: npm run create-admin -- "Admin Name" admin@example.com password123');
  process.exit(1);
}

if (password.length < 6) {
  console.error('Password must be at least 6 characters.');
  process.exit(1);
}

const { data, error } = await supabase
  .from('admins')
  .insert({
    name,
    email: email.trim().toLowerCase(),
    password_hash: await hashPassword(password),
  })
  .select('id, name, email')
  .single();

if (error) {
  console.error('Failed to create admin:', error.message);
  process.exit(1);
}

console.log('Admin created:', data);
