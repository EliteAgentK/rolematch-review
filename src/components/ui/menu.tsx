// Chakra 2's MenuItem on Chakra UI 3's Menu: an optional icon in its own box 0.75rem before the text (the text then fills the row), and
// `to` for an item that is a link to another page of the website.
import { chakra, Menu } from "@chakra-ui/react";
import { cloneElement, forwardRef, isValidElement, type ReactElement, type ReactNode } from "react";
import { Link } from "react-router-dom";

export interface MenuItemProps extends Omit<Menu.ItemProps, "value"> { value?: string; icon?: ReactElement; to?: string; children: ReactNode }

export const MenuItem = forwardRef<HTMLDivElement, MenuItemProps>(function MenuItem({ icon, to, value, children, ...props }, ref) {
  const inner = <>
    {icon && (
      <chakra.span className="chakra-menu__icon" display="inline-flex" alignItems="center" justifyContent="center" flexShrink={0} fontSize="0.8em" marginEnd="0.75rem">
        {isValidElement(icon) ? cloneElement(icon as ReactElement<any>, { "aria-hidden": true, focusable: false }) : icon}
      </chakra.span>
    )}
    {icon ? <span style={{ pointerEvents: "none", flex: 1 }}>{children}</span> : children}
  </>;
  const id = value ?? (typeof children === "string" ? children : to ?? "item");
  return to
    ? <Menu.Item ref={ref} value={id} asChild {...props}><Link to={to}>{inner}</Link></Menu.Item>
    : <Menu.Item ref={ref} value={id} {...props}>{inner}</Menu.Item>;
});
