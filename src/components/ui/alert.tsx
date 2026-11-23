// Chakra 2's Alert pieces on Chakra UI 3: the root keeps role="alert" and data-status as Chakra 2 set them, and AlertIcon draws Chakra 2's
// status icon (Chakra 3's are different shapes).
import { Alert } from "@chakra-ui/react";
import { createContext, forwardRef, useContext } from "react";
import { AlertInfoIcon, AlertSuccessIcon, AlertWarningIcon } from "./icons";

type Status = "info" | "warning" | "success" | "error" | "loading";
const StatusContext = createContext<Status>("info");
const ICONS = { info: AlertInfoIcon, warning: AlertWarningIcon, success: AlertSuccessIcon, error: AlertWarningIcon, loading: AlertInfoIcon };

export const AlertRoot = forwardRef<HTMLDivElement, Alert.RootProps & { status?: Status }>(function AlertRoot({ status = "info", ...props }, ref) {
  return (
    <StatusContext.Provider value={status}>
      <Alert.Root ref={ref} role="alert" data-status={status} status={status} {...props} />
    </StatusContext.Provider>
  );
});

export function AlertIcon(props: Alert.IndicatorProps) {
  const status = useContext(StatusContext), Icon = ICONS[status];
  return <Alert.Indicator data-status={status} {...props}>{props.children ?? <Icon h="100%" w="100%" />}</Alert.Indicator>;
}
