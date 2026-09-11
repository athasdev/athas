import { ResourceSidebarLayout } from "@/ui/resource";
import { Skeleton } from "@/ui/skeleton";

export function GitHubPRSummarySkeleton() {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton className="size-5 rounded-full" />
        <Skeleton className="h-5 w-2/5" />
        <Skeleton className="h-5 w-12 rounded-full" />
      </div>
      <div className="flex items-center gap-4">
        <Skeleton className="h-3.5 w-12" />
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3.5 w-24" />
      </div>
      <Skeleton className="h-3.5 w-3/5" />
    </div>
  );
}

export function GitHubPRTabsSkeleton() {
  return (
    <div className="flex items-center gap-1 py-1">
      <Skeleton className="h-7 w-24" />
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-7 w-32" />
    </div>
  );
}

export function GitHubPRBodySkeleton() {
  return (
    <ResourceSidebarLayout
      sidebar={
        <>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-3.5 w-16" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ))}
        </>
      }
    >
      <div className="space-y-8">
        <div className="space-y-3">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-4 w-3/5" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      </div>
    </ResourceSidebarLayout>
  );
}
