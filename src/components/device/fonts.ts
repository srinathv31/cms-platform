import { Inter } from "next/font/google";

// The device faces, loaded only where the kit is (its root carries `deviceFontVariables`), not app-wide
// like src/styles/fonts.ts. The iPhone skin's stack is `--font-device-ios` in tokens.css: SF on Apple
// devices, where Inter is never fetched, and Inter (OFL) elsewhere. The optical-size axis gives the clock
// Inter's display cut.

const inter = Inter({
  subsets: ["latin"],
  variable: "--ff-device-inter",
  axes: ["opsz"],
  display: "swap",
});

export const deviceFontVariables = inter.variable;
