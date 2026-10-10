// The phone kit's public surface, for Stencil's preview and Coral's phone. Everything else in this folder is
// the kit's own.

export { PushPreview, DEFAULT_CLOCK, type PushPreviewProps } from "./push-preview";
export { SmsPreview, type SmsPreviewProps } from "./sms-preview";
export { ScreenPreview, type ScreenPreviewProps } from "./screen-preview";
export { PhoneSkeleton } from "./phone-skeleton";
export { IOS_LINES } from "./ios/notification-card";
export { ANDROID_LINES } from "./android/notification-card";
export { pushScreenLabel, PLATFORM_STYLE } from "./labels";
export { MIN_SCALE, SCREEN_SIZES, SIZE_UNIT, frameSize, phoneScale, type ScreenSize } from "./geometry";
export type {
  AppMark,
  DeviceAppearance,
  DeviceClock,
  DevicePlatform,
  DeviceSettings,
  DeviceTextSize,
  DeviceWidth,
  FieldFit,
  PhoneFit,
  PushContent,
  PushMeasure,
  PushScreen,
  SmsContent,
  SmsMessage,
} from "./types";
