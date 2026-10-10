import type { DeviceClock, DeviceSettings, PushContent, SmsContent } from "@/components/device";

// Fixture content for the phone kit's design page: one Coral alert, resolved for Maya Chen.

export const CLOCK: DeviceClock = { time: "9:41", date: "Friday, October 9" };

export const SETTINGS: DeviceSettings = {
  platform: "ios",
  appearance: "light",
  previewsHidden: false,
  textSize: "default",
  width: "standard",
};

export const PUSH: PushContent = {
  appName: "Coral",
  appMark: { monogram: "C" },
  title: "Payment due Wednesday",
  subtitle: "Coral Rewards card ending 4821",
  body: "Hi Maya, your minimum payment of $35.00 is due Wednesday, October 14. Pay in the app or at coral.example/pay.",
  time: "now",
};

/** Longer than every screen shows, so each one cuts it somewhere else. */
export const PUSH_LONG: PushContent = {
  ...PUSH,
  title: "Your Coral Rewards payment of $35.00 is due on Wednesday, October 14",
  body:
    "Hi Maya Chen, your minimum payment of $35.00 on your Coral Rewards card ending 4821 is due Wednesday, " +
    "October 14. Pay by 5 p.m. ET in the Coral app or at coral.example/pay to avoid a late fee of up to $40. " +
    "If you've already paid, thank you: there's nothing more to do. Questions? Call 1-800-555-0142, any time.",
};

export const SMS: SmsContent = {
  sender: "26725",
  text:
    "Hi Maya, your minimum payment of $35.00 is due Wed, Oct 14. Pay at coral.example/pay\n" +
    "Coral: Reply STOP to opt out, HELP for help.",
  time: "9:41 AM",
};
