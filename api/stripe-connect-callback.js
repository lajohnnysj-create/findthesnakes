// Vercel serverless function
// Handles Stripe Connect OAuth callback
// Deploy to: /api/stripe-connect-callback.js
//
// Required Vercel environment variables:
//   STRIPE_SECRET_KEY - Your platform's Stripe secret key (sk_live_...)
//
// Flow:
// 1. Creator clicks "Connect Stripe" → redirected to Stripe OAuth
// 2. Creator authorizes → Stripe redirects here with ?code=xxx&state=user_id
// 3. This function exchanges the code for a stripe_account_id
// 4. Stores it in the profiles table via Supabase
// 5. Redirects back to dashboard.html?stripe_connect=success

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;

module.exports = async function handler(req, res) {
  const { code, state, error, error_description } = req.query;

  // If Stripe returned an error (user cancelled, etc.)
  if (error) {
    const reason = encodeURIComponent(error_description || error || 'Authorization cancelled');
    return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${reason}`);
  }

  // Validate we have what we need
  if (!code || !state) {
    return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${encodeURIComponent('Missing authorization code')}`);
  }

  if (!STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY not configured');
    return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${encodeURIComponent('Server configuration error')}`);
  }

  if (!SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_SERVICE_ROLE_KEY not configured');
    return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${encodeURIComponent('Server configuration error')}`);
  }

  const userId = state; // We passed currentUser.id as the state param

  try {
    // Exchange the authorization code for a Stripe account ID
    const tokenResponse = await fetch('https://connect.stripe.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_secret: STRIPE_SECRET_KEY,
      }).toString(),
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('Stripe OAuth error:', tokenData.error, tokenData.error_description);
      const reason = encodeURIComponent(tokenData.error_description || tokenData.error);
      return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${reason}`);
    }

    const stripeAccountId = tokenData.stripe_user_id;
    if (!stripeAccountId) {
      console.error('No stripe_user_id in response:', tokenData);
      return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${encodeURIComponent('No account ID returned')}`);
    }

    // Store the stripe_account_id in the profiles table
    const updateResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?user_id=eq.${userId}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ stripe_account_id: stripeAccountId }),
      }
    );

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      console.error('Supabase update failed:', updateResponse.status, errorText);
      return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${encodeURIComponent('Failed to save account')}`);
    }

    console.log(`Stripe Connect: user ${userId} connected account ${stripeAccountId}`);

    // Success — redirect back to dashboard
    return res.redirect(302, `/dashboard.html?stripe_connect=success`);

  } catch (err) {
    console.error('Stripe Connect callback error:', err);
    return res.redirect(302, `/dashboard.html?stripe_connect=error&reason=${encodeURIComponent('Server error — please try again')}`);
  }
};
