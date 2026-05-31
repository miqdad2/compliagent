import { Select } from "@/components/ui/select";
import { documentRoleLabels } from "@/lib/documents/roles";
import { documentRoles } from "@/types/domain";

type DocumentRoleSelectProps = {
  name?: string;
  defaultValue?: string;
};

export function DocumentRoleSelect({ name = "documentRole", defaultValue = "main_specification" }: DocumentRoleSelectProps) {
  return (
    <Select defaultValue={defaultValue} name={name}>
      {documentRoles.map((role) => (
        <option key={role} value={role}>
          {documentRoleLabels[role]}
        </option>
      ))}
    </Select>
  );
}
