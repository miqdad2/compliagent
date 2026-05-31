import { cookies } from "next/headers";
import {
  createStaticSessionToken,
  staticAuthCookieName,
  staticAuthSessionMaxAgeSeconds,
  verifyStaticSessionToken
} from "./static-auth-core";

export * from "./static-auth-core";

export async function getStaticAuthSession() {
  const cookieStore = await cookies();
  return verifyStaticSessionToken(cookieStore.get(staticAuthCookieName)?.value);
}

export async function setStaticAuthSessionCookie() {
  const cookieStore = await cookies();
  const token = await createStaticSessionToken();

  cookieStore.set(staticAuthCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: staticAuthSessionMaxAgeSeconds
  });
}

export async function clearStaticAuthSessionCookie() {
  const cookieStore = await cookies();
  cookieStore.set(staticAuthCookieName, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}
