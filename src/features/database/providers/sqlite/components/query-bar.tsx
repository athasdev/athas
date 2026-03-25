import { Code, Search, X } from "lucide-react";
import { Button } from "@/ui/button";
import Input from "@/ui/input";
import Textarea from "@/ui/textarea";

interface QueryBarProps {
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  customQuery: string;
  setCustomQuery: (query: string) => void;
  isCustomQuery: boolean;
  setIsCustomQuery: (is: boolean) => void;
  executeCustomQuery: () => void;
  isLoading: boolean;
}

export default function QueryBar({
  searchTerm,
  setSearchTerm,
  customQuery,
  setCustomQuery,
  isCustomQuery,
  setIsCustomQuery,
  executeCustomQuery,
  isLoading,
}: QueryBarProps) {
  if (isCustomQuery) {
    return (
      <div className="px-3 py-2">
        <Textarea
          value={customQuery}
          onChange={(e) => setCustomQuery(e.target.value)}
          className="mb-1 h-20 resize-none rounded-xl border-border/70 bg-secondary-bg/60"
          placeholder="SELECT * FROM table_name"
          disabled={isLoading}
        />
        <div className="flex justify-end gap-2">
          <Button onClick={() => setIsCustomQuery(false)} variant="ghost" size="sm">
            <X className="mr-1" />
            Cancel
          </Button>
          <Button
            onClick={executeCustomQuery}
            variant="default"
            size="sm"
            disabled={isLoading || !customQuery.trim()}
          >
            <Code className="mr-1" />
            Execute
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search..."
            leftIcon={Search}
            size="sm"
          />
          {searchTerm && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setSearchTerm("")}
              className="-translate-y-1/2 absolute top-1/2 right-1.5 text-text-lighter hover:text-text"
              aria-label="Clear search"
            >
              <X />
            </Button>
          )}
        </div>
        <Button onClick={() => setIsCustomQuery(true)} variant="default" size="sm">
          <Code className="mr-1" />
          SQL
        </Button>
      </div>
    </div>
  );
}
