import { WS } from "@/components/workspace/workspace-grid";

export default function TemplateActivityPage() {
  return <div data-slot="activity" className={`${WS.doc} min-h-[24rem]`} />;
}
