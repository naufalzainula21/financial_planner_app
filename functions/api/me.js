import { json } from '../../server/lib.js';

export async function onRequestGet({ env, data }) {
  if (data.user) return json({ signedIn: true, email: data.user.email });
  return json({ signedIn: false, needsCode: !!env.SIGNUP_CODE });
}
