export default async function handler(req, res) {
  // Add CORS headers for local development if needed
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(500).json({ error: 'Server configuration error: missing GitHub credentials' });
  }

  // If GET, redirect to GitHub authorization page or handle callback
  if (req.method === 'GET') {
    if (req.query && req.query.code) {
      res.redirect(302, `https://meyee.vercel.app/?code=${req.query.code}`);
      return;
    }

    const callbackUrl = encodeURIComponent('https://meyee.vercel.app/api/github-auth');
    const redirectUri = `https://github.com/login/oauth/authorize?client_id=${clientId}&scope=gist&redirect_uri=${callbackUrl}`;
    res.redirect(302, redirectUri);
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Missing code parameter' });
  }



  try {
    const githubRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: code
      })
    });

    const data = await githubRes.json();

    if (data.error) {
      return res.status(400).json({ error: data.error_description || data.error });
    }

    // data typically contains { access_token, token_type, scope }
    return res.status(200).json(data);
  } catch (error) {
    console.error('GitHub token exchange error:', error);
    return res.status(500).json({ error: 'Internal server error during token exchange' });
  }
}
