import { requireDemoSession } from "@/lib/demo/is-demo-request";
import { DemoContentGenerator } from "@/features/demo/content-generator";

export default async function DemoContentPage() {
  await requireDemoSession();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Content AI (Demo)</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Hasilkan caption media sosial siap pakai dalam hitungan detik.
        </p>
      </div>

      <DemoContentGenerator />
    </div>
  );
}
