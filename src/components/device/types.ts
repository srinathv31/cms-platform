// The phone kit's public types. The kit draws what it is given: every string arrives resolved (variables
// already replaced with values), and nothing here knows about templates, channels or versions. Stencil's
// preview and Coral's phone both build these from their own data.

/** Which phone's look. Each platform is one skin under `src/components/device/<platform>/`. */
export type DevicePlatform = "ios" | "android";

/** The phone's light or dark appearance. Independent of the app around it, which is light only. */
export type DeviceAppearance = "light" | "dark";

/**
 * The reader's text size. `default` is the system default; `large` is the largest standard size; `ax` is
 * the first accessibility size. Each platform maps these to its own type ramp (iOS: Large, xxxLarge, AX1).
 */
export type DeviceTextSize = "default" | "large" | "ax";

/** The phone's width class. iOS: 375, 402 and 440 points. */
export type DeviceWidth = "compact" | "standard" | "large";

export interface DeviceSettings {
  platform: DevicePlatform;
  appearance: DeviceAppearance;
  /**
   * "Show previews: When unlocked" on a locked phone. It changes the lock screen only, where a bystander
   * sees the phone: iOS shows the app and "Notification" there. A banner arrives on an unlocked phone and
   * the expanded view opens after Face ID, so both still show the content, as they do on a real phone.
   */
  previewsHidden: boolean;
  textSize: DeviceTextSize;
  width: DeviceWidth;
}

/**
 * How the phone fits its container. It is laid out at its real size and scaled down to fit (never up),
 * in its true proportions; see Geometry in the kit's README.
 */
export interface PhoneFit {
  /**
   * The smallest scale for the container's height (default `MIN_SCALE`, 0.55). In a shorter container the
   * phone keeps this scale and runs past the container's bottom, for a scroller round it to scroll. Width
   * always fits.
   */
  minScale?: number;
  /** Empty px kept under the phone, inside its box: the space a scroller leaves below it at the end. Default 0. */
  room?: number;
}

/** Where a push notification is seen. */
export type PushScreen = "lock" | "banner" | "expanded";

/** The sending app's mark: a monogram on a tile in the brand's tone. No real app icons. */
export interface AppMark {
  /** One or two characters, e.g. "C". */
  monogram: string;
}

/** One push notification, as the phone shows it. Plain text: line breaks in the body are kept. */
export interface PushContent {
  /** The app's name, e.g. "Coral". Read out first, and shown on the lock screen when previews are hidden. */
  appName: string;
  appMark: AppMark;
  title: string;
  /** iPhone only. Empty or missing: no subtitle line. */
  subtitle?: string;
  body: string;
  /** When it arrived, as the phone prints it: "now", "9:41 AM". */
  time: string;
}

/** One text message in a thread. */
export interface SmsMessage {
  /** The whole message, footer included, exactly as delivered. Line breaks are kept. */
  text: string;
  /** The time above the message: "9:41 AM". */
  time: string;
  /** The day before the time. Default "Today". */
  day?: string;
}

/** A text message from a sender, as the Messages app shows it, under any earlier ones from the same sender. */
export interface SmsContent extends SmsMessage {
  /**
   * What the thread's header shows: a US short code ("26725") or a number. A brand name can't appear here.
   * Empty: no sender, and the header shows a muted "No sender".
   */
  sender: string;
  /**
   * Earlier texts from the same sender, oldest first, drawn above this one. The thread opens on this, the
   * newest. Empty or missing: this text alone.
   */
  earlier?: readonly SmsMessage[];
}

/** The phone's own clock: the status bar and the lock screen. */
export interface DeviceClock {
  /** "9:41" */
  time: string;
  /** The lock screen's date line: "Friday, October 9". */
  date: string;
}

/** How one field of a notification fits the screen it is on, measured from the rendered phone. */
export interface FieldFit {
  /** The field is on this screen. False when the screen leaves it out (previews hidden on the lock screen). */
  shown: boolean;
  /** Some of the text doesn't show: the platform cut it at `maxLines`. */
  cut: boolean;
  /**
   * What a reader sees, without the ellipsis and trailing spaces: the whole text when nothing is cut,
   * otherwise the text up to the last character before the ellipsis. It can end mid-word.
   */
  visibleText: string;
  /** Lines on screen. */
  lines: number;
  /** Lines the whole text would take. More than `lines` when cut. */
  fullLines: number;
  /** The most lines this screen shows for the field. */
  maxLines: number;
}

/** Truncation per field for the screen on show. `subtitle` is null when the content has none. */
export interface PushMeasure {
  platform: DevicePlatform;
  screen: PushScreen;
  title: FieldFit;
  subtitle: FieldFit | null;
  body: FieldFit;
}
