// src/components/DashboardNavbar.tsx
import { forgetAll } from "../utils/warm";
import {
  Box,
  Flex,
  HStack,
  Menu,
  Text,
} from "@chakra-ui/react";
import { Image } from "./ui/image";
import { FiHelpCircle, FiLogOut, FiSettings, FiUser } from "react-icons/fi";
import { useColorMode, useColorModeValue } from "../theme/color-mode";
import { Avatar } from "./ui/avatar";
import LiveClock from "./LiveClock";
import { IconButton } from "./ui/icon-button";
import { MoonIcon, SunIcon } from "./ui/icons";
import { MenuItem } from "./ui/menu";
import { Tooltip } from "./ui/tooltip";
import { Link, useNavigate } from "react-router-dom";
import { clearAuthCookies } from "../utils/cookieManager";
import { api } from "../api/client";
import { forgetDemoProfiles } from "../utils/forgetDemoProfiles";
import SignOutOverlay from "./SignOutOverlay";
import { useEffect, useState } from "react";
import { useOptionalSettings } from "../settings/SettingsContext";
import { navigateWithTransition } from "../utils/viewTransition";

interface DashboardNavbarProps {
  onHelpClick?: () => void;
  /** Which of the two views is open: the switch between them sits in the middle of the header (owner, 10 Nov 2026). */
  view?: "overview" | "board";
}

export default function DashboardNavbar({ onHelpClick, view }: DashboardNavbarProps) {
  const navigate = useNavigate();
  const { colorMode, toggleColorMode } = useColorMode();
  const bgColor = useColorModeValue("white", "gray.800");
  const borderColor = useColorModeValue("gray.200", "gray.700");
  const logoSrc = useColorModeValue("/logo-light.png", "/logo-dark.png"), orgColour = useColorModeValue("gray.600", "gray.300");
  const orgLabel = useOptionalSettings()?.orgLabel ?? "";
  const viewsBg = useColorModeValue("gray.50", "whiteAlpha.50"), viewIdle = useColorModeValue("gray.600", "gray.300"), viewHover = useColorModeValue("gray.900", "white");
  
  const [signingOut, setSigningOut] = useState(false);
  // Who is signed in, as the server says: never anything kept in this browser, which could be the previous person's (code review, 16 Nov 2026).
  const [account, setAccount] = useState<{ name: string; email: string } | null>(null);
  useEffect(() => { api.me().then(({ user }) => setAccount({ name: user.name ?? "", email: user.email ?? "" })).catch(() => {}); }, []);
  const accountName = (account?.name ?? "").split(" ")[0] ?? "";

  const handleLogout = () => {
    if (signingOut) return;
    // End the server session, clear leftover local cookies, show a short goodbye, then leave.
    setSigningOut(true);
    forgetAll(); api.logout().catch(() => {});
    clearAuthCookies();
    forgetDemoProfiles(); // nothing personal stays in this browser after signing out
    setTimeout(() => { window.location.href = "/"; }, 3300);
  };

  return (
    <>
    <SignOutOverlay isOpen={signingOut} name={accountName} />
    <Box
      as="header"
      bg={bgColor}
      borderBottom="1px solid"
      borderColor={borderColor}
      position="sticky"
      top={0}
      zIndex={10}
      boxShadow="sm"
      width="100%"
      // Named so the page change between the Overview and the Board leaves the header where it is (src/theme/motion.css).
      style={{ viewTransitionName: "rm-header" } as React.CSSProperties}
    >
      <Flex
        height="72px"
        width="100%"
        maxWidth="1600px"
        mx="auto"
        position="relative"
        justifyContent="space-between"
        alignItems="center"
        // Three columns with equal outer sides, so the view switch sits at the true centre of the screen however long the organisation's name is
        // (owner, 10 Nov 2026: "the overview/matching board always needs to be centred").
        display={{ base: "flex", md: "grid" }}
        gridTemplateColumns={{ md: "minmax(0, 1fr) auto minmax(0, 1fr)" }}
        gap={4}
        px={{ base: 4, md: 7 }}
      >
        {/* Left - RoleMatch, larger, and the organisation beside it (one portal per organisation: owner, 10 Nov 2026) */}
        <Box minW={0} justifySelf="start">
        <Link to="/overview" aria-label="RoleMatch: overview">
          <Flex align="center" gap={4} minW={0}>
            <Image src={logoSrc} alt="RoleMatch" height={{ base: "30px", md: "34px", xl: "40px" }} objectFit="contain" flexShrink={0} />
            {orgLabel && <Text display={{ base: "none", sm: "block" }} pl={4} borderLeft="1px solid" borderColor={borderColor} fontFamily="heading" fontSize="lg" fontWeight="semibold" color={orgColour} truncate minW={0} maxW={{ base: "36vw", md: "320px" }} title={`${orgLabel}: your organisation`}>{orgLabel}</Text>}
          </Flex>
        </Link>
        </Box>

        {/* Centre - the two views. On a phone the same switch is a bar at the bottom of the screen, where a thumb reaches it. */}
        <Box className="rm-views" role="navigation" aria-label="Views" display="flex" gap={1} p={1} borderRadius="xl" border="1px solid" borderColor={borderColor} bg={viewsBg}
          position={{ base: "fixed", md: "static" }} bottom={{ base: 3, md: "auto" }} left={{ base: 4, md: "auto" }} right={{ base: 4, md: "auto" }} zIndex={20} boxShadow={{ base: "lg", md: "none" }} backdropFilter="blur(12px)">
          {([["overview", "Overview", "/overview"], ["board", "Matching Board", "/dashboard"]] as const).map(([v, label, to]) => (
            <Box as="button" key={v} {...({ type: "button" } as object)} onClick={() => { if (view !== v) navigateWithTransition(navigate, to); else if (v === "board") window.dispatchEvent(new Event("rolematch:board-home")); }} aria-current={view === v ? "page" : undefined} flex={{ base: 1, md: "none" }}
              px={{ base: 3, md: 5 }} py={2} borderRadius="lg" fontWeight="semibold" fontSize="sm" whiteSpace="nowrap" cursor="pointer" transition="background .3s cubic-bezier(.16,1,.3,1), color .3s"
              color={view === v ? "white" : viewIdle} bgGradient={view === v ? "to-br" : undefined} gradientFrom={view === v ? "#227C9D" : undefined} gradientTo={view === v ? "#17C3B2" : undefined}
              boxShadow={view === v ? "0 6px 22px -8px #17C3B2" : "none"} _hover={view === v ? undefined : { color: viewHover }}
              _focusVisible={{ outline: "2px solid", outlineColor: "blue.400", outlineOffset: "2px" }}>{label}</Box>
          ))}
        </Box>

        {/* Right - Controls */}
        <Flex justify="flex-end" align="center">
          <HStack gap={3}>
            {/* The device's own time, always in view, right beside the light and dark switch (owner, 12 Nov 2026). */}
            <LiveClock />
            <Tooltip content={colorMode === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}>
              <IconButton aria-label="Toggle color mode" onClick={toggleColorMode} variant="ghost" size="md">{colorMode === 'light' ? <MoonIcon /> : <SunIcon />}</IconButton>
            </Tooltip>

            <Menu.Root closeOnSelect={false} positioning={{ placement: "bottom-end" }}>
              <Menu.Trigger asChild>
              <Avatar
                aria-label="Your account"
                role="button"
                tabIndex={0}
                size="sm"
                cursor="pointer"
                name={account?.name || account?.email || ""}
                _hover={{ 
                  transform: "scale(1.05)",
                  boxShadow: "0 0 0 3px rgba(66, 153, 225, 0.6)"
                }}
                transition="all 0.2s"
              />
              </Menu.Trigger>
              {/* not portalled, as under Chakra 2: the list sits in the header */}
              <Menu.Positioner zIndex={100}>
              <Menu.Content
                className="rm-hinge"
                zIndex={100}
                minWidth="240px"
                py={2}
                shadow="lg"
              >
                <Box px={4} py={2} borderBottom="1px solid" borderColor={borderColor}>
                  <Box fontWeight="bold">{account ? account.name || "Your account" : "Loading..."}</Box>
                  <Box fontSize="sm" opacity={0.8}>{account?.email ?? ""}</Box>
                </Box>
                <MenuItem icon={<FiUser />} py={2} to="/profile">Profile</MenuItem>
                <MenuItem icon={<FiSettings />} py={2} to="/settings">Settings</MenuItem>
                <MenuItem icon={<FiHelpCircle />} py={2} onClick={onHelpClick}>Help & Support</MenuItem>
                <Menu.Separator />
                <MenuItem 
                  icon={<FiLogOut />} 
                  py={2}
                  onClick={handleLogout}
                  color="red.500"
                  _hover={{ bg: "red.50" }}
                >
                  Sign Out
                </MenuItem>
              </Menu.Content>
              </Menu.Positioner>
            </Menu.Root>
          </HStack>
        </Flex>
      </Flex>
    </Box>
    </>
  );
}
