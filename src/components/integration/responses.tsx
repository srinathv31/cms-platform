import type { IntegrationPanelData } from "@/domain/golive-types";
import type { Channel } from "@/domain/types";
import { CodeBlock } from "./code-block";

const NAME: Record<Channel | "base64", string> = { pdf: "PDF", web: "Web", email: "Email", base64: "Base64" };

/** What comes back on a 200 for each enabled channel (and the base64 opt-in), then the errors worth handling. */
export function Responses({
  responses,
  errors,
  channels,
}: {
  responses: IntegrationPanelData["responses"];
  errors: IntegrationPanelData["errors"];
  channels: readonly Channel[];
}) {
  const shown = responses.filter((r) => r.channel === "base64" || channels.includes(r.channel));
  return (
    <div className="flex flex-col gap-5">
      <ul aria-label="Response formats" className="flex flex-col">
        {shown.map((r) => (
          <li key={r.channel} className="flex gap-4 border-b border-hairline py-3 first:pt-0 last:border-b-0">
            <span className="w-14 shrink-0 text-[13px] font-medium leading-5 text-text">{NAME[r.channel]}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="break-all font-mono text-[12.5px] leading-5 text-text-muted">{r.contentType}</span>
              <p className="text-[13px] leading-5 text-text">{r.body}</p>
              {r.example ? (
                <CodeBlock label={`${NAME[r.channel]} example`} maxHeightClass="max-h-48" className="mt-1.5">
                  {r.example}
                </CodeBlock>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      <table aria-label="Errors" className="w-full table-fixed border-collapse text-[13px]">
        <colgroup>
          <col className="w-[3.25rem]" />
          <col className="w-[10.5rem]" />
          <col />
        </colgroup>
        <thead>
          <tr className="border-b border-hairline text-left">
            {(["Status", "Code", "When"] as const).map((h) => (
              <th key={h} scope="col" className="caps-label h-8 pr-3 text-left font-medium last:pr-0">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {errors.map((e) => (
            <tr key={e.code} className="border-b border-hairline align-top last:border-b-0">
              <td className="py-2.5 pr-3 font-mono text-[12.5px] leading-5 text-text">{e.status}</td>
              <td className="py-2.5 pr-3 break-all font-mono text-[12.5px] leading-5 text-text">{e.code}</td>
              <td className="py-2.5 leading-5 text-text-muted">{e.when}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
