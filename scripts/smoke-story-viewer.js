/**
 * Smoke test: POST /api/instagram/story-viewer
 * Usage: node scripts/smoke-story-viewer.js [username] [baseUrl]
 */
const username = process.argv[2] || 'instagram';
const baseUrl = (process.argv[3] || process.env.API_BASE || 'http://localhost:5001').replace(
  /\/$/,
  ''
);

async function main() {
  const url = `${baseUrl}/api/instagram/story-viewer`;
  console.log(`POST ${url} username=${username}`);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });

  const body = await res.json();
  console.log('Status:', res.status);
  console.log('Success:', body.success);
  console.log('Processing ms:', body.processingTime ?? body.data?.processingTime);
  console.log('Stories count:', body.data?.userStories?.length ?? 0);
  console.log('Cached:', body.cached ?? false);

  if (!res.ok) {
    console.error('Error:', body.error || body);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
