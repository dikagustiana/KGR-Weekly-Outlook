import Link from "next/link";
import { ASSIGNMENT_PATH } from "@/lib/v5/assignment";

/** A7: the way to the assignment screen from Komersial and Admin → Pengguna (shown to the roles of area `sales_assignment` only). */
export function AssignmentLink({ className = "note" }: { className?: string }) {
  return <p className={className} data-assignment-link=""><Link href={ASSIGNMENT_PATH}>Penugasan Sales: SKU dan pelanggan per Sales →</Link></p>;
}
