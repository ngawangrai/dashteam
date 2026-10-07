import { PageSkeleton } from "@/components/skeletons";

export default function Loading() {
  return <PageSkeleton withBack sections={2} />;
}
