// Notices that pop up at the bottom of the page, as Chakra 2 showed them: a solid alert with its status icon, title, description and an
// optional close button, 8px above the bottom edge, five seconds unless told otherwise. Use toaster.create({ title, description, type, closable }).
import { Alert, Box, Portal, Toast, Toaster as ChakraToaster, createToaster } from "@chakra-ui/react";
import { AlertIcon, AlertRoot } from "./alert";
import { CloseButton } from "./close-button";

export const toaster = createToaster({ placement: "bottom", duration: 5000, offsets: "0.5rem", gap: 16 });

export function Toaster() {
  return (
    <Portal>
      <ChakraToaster toaster={toaster}>
        {(toast) => (
          <Toast.Root>
            <AlertRoot status={(toast.type as any) ?? "info"} variant="solid" role={undefined} alignItems="start" borderRadius="md" boxShadow="lg" paddingEnd={8} textAlign="start" width="auto">
              <AlertIcon />
              <Box flex="1" maxWidth="100%">
                {toast.title && <Alert.Title>{toast.title}</Alert.Title>}
                {toast.description && <Alert.Description display="block">{toast.description}</Alert.Description>}
              </Box>
              {toast.closable && <Toast.CloseTrigger asChild><CloseButton size="sm" position="absolute" insetEnd={1} top={1} /></Toast.CloseTrigger>}
            </AlertRoot>
          </Toast.Root>
        )}
      </ChakraToaster>
    </Portal>
  );
}
