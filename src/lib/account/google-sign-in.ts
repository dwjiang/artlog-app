import { GoogleSignin, isCancelledResponse } from "@react-native-google-signin/google-signin";

const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

export const googleSignInAvailable = !!iosClientId && !!webClientId;

export async function googleSignIn() {
  if (!googleSignInAvailable) throw new Error("Google sign-in is not configured");
  GoogleSignin.configure({ iosClientId, webClientId });
  // Clear the SDK's cached account so each explicit sign-in can choose a different person.
  await GoogleSignin.signOut();
  const result = await GoogleSignin.signIn();
  if (isCancelledResponse(result)) return null;
  if (!result.data.idToken) throw new Error("Google did not return an identity token");
  return {
    identityToken: result.data.idToken,
    user: result.data.user.id,
    name: result.data.user.name?.trim(),
  };
}
