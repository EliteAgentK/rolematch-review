// Chakra 2's CloseButton (Chakra UI 3's is a ghost icon button with a different size and look): its recipe is closeButton in src/theme/recipes.ts.
import { createRecipeContext, type HTMLChakraProps, type RecipeProps } from "@chakra-ui/react";
import { forwardRef } from "react";
import { CloseIcon } from "./icons";

const { withContext } = createRecipeContext({ key: "closeButton" });
const Styled = withContext<HTMLButtonElement, HTMLChakraProps<"button"> & RecipeProps<"closeButton">>("button");

export type CloseButtonProps = HTMLChakraProps<"button"> & { size?: "sm" | "md" | "lg" };
export const CloseButton = forwardRef<HTMLButtonElement, CloseButtonProps>(function CloseButton({ children, ...props }, ref) {
  return <Styled type="button" aria-label="Close" ref={ref} {...(props as any)}>{children ?? <CloseIcon width="1em" height="1em" />}</Styled>;
});
