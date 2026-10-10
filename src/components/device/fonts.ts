import { Google_Sans_Flex, Inter } from "next/font/google";

// The device faces, loaded only where the kit is (its root carries `deviceFontVariables`), not app-wide
// like src/styles/fonts.ts. The stacks are `--font-device-ios` and `--font-device-android` in tokens.css.
//   iPhone: SF on Apple devices, where Inter is never fetched, and Inter (OFL) elsewhere. The optical-size
//   axis gives the clock Inter's display cut.
//   Android: Google Sans Flex (OFL), the face of current Pixels. Its roundness axis rounds the lock clock,
//   as Material 3 Expressive does.

const inter = Inter({
  subsets: ["latin"],
  variable: "--ff-device-inter",
  axes: ["opsz"],
  display: "swap",
});

const googleSans = Google_Sans_Flex({
  subsets: ["latin"],
  variable: "--ff-device-google-sans",
  axes: ["opsz", "ROND"],
  display: "swap",
  // next/font has no metrics to size a fallback to this face: name the platform's own instead.
  adjustFontFallback: false,
  fallback: ["Roboto", "system-ui", "sans-serif"],
});

export const deviceFontVariables = `${inter.variable} ${googleSans.variable}`;
