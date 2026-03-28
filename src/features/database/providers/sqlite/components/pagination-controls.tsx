import { Button } from "@/ui/button";
import Select from "@/ui/select";

const PAGE_SIZES = [
  { value: "10", label: "10" },
  { value: "25", label: "25" },
  { value: "50", label: "50" },
  { value: "100", label: "100" },
  { value: "500", label: "500" },
];

interface PaginationControlsProps {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

export default function PaginationControls({
  currentPage,
  totalPages,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: PaginationControlsProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <div className="flex items-center gap-2">
        <Select
          value={pageSize.toString()}
          options={PAGE_SIZES}
          onChange={(v) => onPageSizeChange(Number(v))}
          size="xs"
          className="min-w-16"
        />
        <span className="text-text-lighter text-xs">per page</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
          variant="ghost"
          size="xs"
          className="text-text-lighter text-xs hover:text-text disabled:opacity-50"
          aria-label="Previous page"
        >
          Prev
        </Button>
        <span className="px-2 text-xs">
          {currentPage} / {totalPages}
        </span>
        <Button
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
          variant="ghost"
          size="xs"
          className="text-text-lighter text-xs hover:text-text disabled:opacity-50"
          aria-label="Next page"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
