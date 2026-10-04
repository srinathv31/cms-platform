import { resetDemo } from "@/server/reset";

async function main() {
  const started = Date.now();
  const { counts } = await resetDemo();
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  console.log(
    `Demo reset in ${((Date.now() - started) / 1000).toFixed(1)}s: ` +
      `${counts.users} users, ${counts.templates} templates, ${counts.versions} versions, ` +
      `${counts.render_log} renders (${total} rows).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
