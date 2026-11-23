// Chakra 2's Switch on Chakra UI 3: a label holding the hidden checkbox, the track with its thumb, and optional text. As in Chakra 2, `id`
// and `aria-label` belong to the checkbox itself, so a label's htmlFor and screen readers reach it. Changes arrive as onCheckedChange({ checked }).
import { Switch as ChakraSwitch } from "@chakra-ui/react";
import { forwardRef, type ReactNode } from "react";

export interface SwitchProps extends Omit<ChakraSwitch.RootProps, "id"> { id?: string; "aria-label"?: string; children?: ReactNode }

export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch({ id, "aria-label": ariaLabel, children, ...rest }, ref) {
  return (
    <ChakraSwitch.Root ids={id ? { hiddenInput: id } : undefined} {...rest}>
      <ChakraSwitch.HiddenInput ref={ref} className="chakra-switch__input" aria-label={ariaLabel} />
      <ChakraSwitch.Control className="chakra-switch__track"><ChakraSwitch.Thumb className="chakra-switch__thumb" /></ChakraSwitch.Control>
      {children != null && <ChakraSwitch.Label className="chakra-switch__label">{children}</ChakraSwitch.Label>}
    </ChakraSwitch.Root>
  );
});
