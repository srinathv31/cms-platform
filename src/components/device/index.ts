// The phone kit's public surface, for Stencil's preview and Coral's phone. Everything else in this folder is
// the kit's own.

export { PushPreview, DEFAULT_CLOCK, type PushPreviewProps } from "./push-preview";
export { SmsPreview, type SmsPreviewProps } from "./sms-preview";
export { IOS_LINES } from "./ios/notification-card";
export { SCREEN_SIZES, type ScreenSize } from "./geometry";
export type {
  AppMark,
  DeviceAppearance,
  DeviceClock,
  DevicePlatform,
  DeviceSettings,
  DeviceTextSize,
  DeviceWidth,
  FieldFit,
  PushContent,
  PushMeasure,
  PushScreen,
  SmsContent,
} from "./types";
