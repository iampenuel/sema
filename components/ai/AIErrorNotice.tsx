import { CircleAlert } from "lucide-react";

export function AIErrorNotice({ message }: { message: string }) {
  return <p role="alert" className="flex items-start gap-2 rounded-md border border-[#e4cece] bg-[#fffafa] px-3 py-2 text-xs leading-5 text-[#784444]"><CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{message}</p>;
}
