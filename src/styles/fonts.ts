import { Figtree, Geist_Mono, Newsreader } from "next/font/google";

// Newsreader (display serif) + Figtree (UI sans) + Geist Mono (variable keys).
// Chosen by Sri on Oct 4 (pairing B). TD's fonts later: change this file and tokens.css.

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--ff-newsreader",
  style: ["normal", "italic"],
});

const figtree = Figtree({ subsets: ["latin"], variable: "--ff-figtree" });

const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--ff-geist-mono" });

export const fontVariables = [newsreader.variable, figtree.variable, geistMono.variable].join(" ");
