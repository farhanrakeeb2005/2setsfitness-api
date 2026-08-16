const BASE = 'http://localhost:3000';
let token = '';

async function req(method, path, body, auth) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  console.log(`\n${method} ${path} → ${res.status}`);
  console.log(JSON.stringify(data, null, 2));
  return data;
}

async function run() {
  // 1. Health check
  await req('GET', '/health');

  // 2. Register
  const reg = await req('POST', '/auth/register', {
    email: 'test@test.com',
    password: 'Test1234',
    name: 'Mohammed',
  });
  token = reg.token || '';

  // 3. Login (in case already registered)
  if (!token) {
    const login = await req('POST', '/auth/login', {
      email: 'test@test.com',
      password: 'Test1234',
    });
    token = login.token || '';
  }

  console.log('\nToken:', token ? token.slice(0, 30) + '...' : 'MISSING');

  // 4. Get profile
  await req('GET', '/profile', null, true);

  // 5. Log a workout to history
  await req('POST', '/history', {
    name: 'Leg Day',
    sets: 3,
    volume: 450,
    exercises: [
      { exercise: 'squat', reps: 8, formScore: 85 },
      { exercise: 'squat', reps: 7, formScore: 80 },
      { exercise: 'squat', reps: 6, formScore: 78 },
    ],
  }, true);

  // 6. Get history
  await req('GET', '/history', null, true);

  // 7. Test AI coach
  await req('POST', '/ai/coach', {
    exercise: 'squat',
    reps: 8,
    score: 85,
    setNum: 1,
    recentSets: [],
  }, true);
}

run().catch(console.error);
