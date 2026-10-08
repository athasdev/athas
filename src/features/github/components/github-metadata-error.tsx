import { Alert, AlertActions, AlertDescription, AlertTitle } from "@/ui/alert";
import { Button } from "@/ui/button";

interface GitHubMetadataErrorProps {
  message: string;
  onRetry: () => void;
}

export function GitHubMetadataError({ message, onRetry }: GitHubMetadataErrorProps) {
  return (
    <Alert tone="error">
      <AlertTitle>Labels and milestones are unavailable</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <AlertActions>
        <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </AlertActions>
    </Alert>
  );
}
