"""Run only against a disposable bridge-it-* Docker database; leaves synthetic fixtures."""
import concurrent.futures
import pathlib
import subprocess
import sys

container = sys.argv[1] if len(sys.argv) > 1 else 'bridge-it-improve-test'
if not container.startswith('bridge-it-'):
    raise SystemExit('Use a disposable bridge-it-* Docker database only')
command = ['docker', 'exec', '-i', container, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At']
def sql(query):
    return subprocess.run(command, input=query, text=True, capture_output=True)
# Each account has its own five-request limit; all share the twelve-request network limit.
for n in range(1, 5):
    uid = f'00000000-0000-0000-0000-{100+n:012d}'
    result = sql(f"""INSERT INTO auth.users (id,email) VALUES ('{uid}','concurrency-{n}@bridge.test');
    INSERT INTO bridge_ai."CustomerContact" (id,"displayNameEncrypted","phoneEncrypted","phoneHash","buyerAuthUserId","createdAt","updatedAt")
    VALUES ('concurrency_customer_{n}',decode('00','hex'),decode('00','hex'),'concurrency-phone-{n}','{uid}',now(),now());""")
    if result.returncode: raise RuntimeError(result.stderr)
def reserve(n):
    customer = n % 4 + 1
    uid = f'00000000-0000-0000-0000-{100+customer:012d}'
    return sql(f"""BEGIN;
    SET SESSION AUTHORIZATION bridge_ai_app;
    SELECT set_config('bridge_ai.worker_context','buyer_auth',true);
    INSERT INTO bridge_ai."BuyerLoginChallenge" (id,"customerContactId","authUserId","tokenDigest","requestIpHash","expiresAt")
    VALUES ('concurrency_challenge_{n}','concurrency_customer_{customer}','{uid}',md5('challenge-{n}')||md5('challenge-{n}'),repeat('e',64),now()+interval '10 minutes');
    SELECT pg_sleep(0.03); COMMIT;""")
with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
    results = list(pool.map(reserve, range(20)))
success = sum(r.returncode == 0 for r in results)
assert success == 12, f'Expected 12 successful network reservations, got {success}'
assert all(r.returncode == 0 or 'BUYER_LOGIN_RATE_LIMITED' in r.stderr for r in results)
counts = sql('SELECT max(n) FROM (SELECT count(*) n FROM bridge_ai."BuyerLoginChallenge" WHERE "customerContactId" LIKE \'concurrency_customer_%\' GROUP BY "customerContactId") counts;')
assert int(counts.stdout.strip()) <= 5, counts.stdout
count = sql('SELECT count(*) FROM bridge_ai."AuditLog" WHERE action=\'BUYER.LOGIN_RESERVED\' AND "entityId" LIKE \'concurrency_challenge_%\';')
assert int(count.stdout.strip()) == 12, count.stdout
print('Concurrent login limits passed: 12/20 network reservations, no customer above 5, all successful reservations audited.')
