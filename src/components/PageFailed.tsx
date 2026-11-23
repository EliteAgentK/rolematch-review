// What shows when a page cannot be put on screen at all (its code could not be fetched, even after one reload onto the latest release, or it failed while
// drawing): a plain sentence and a way forward, never an empty screen (owner, 11 Nov 2026: "I should never be stuck on a screen"). Nothing a user typed
// is lost by this screen itself; reloading fetches the latest release.
import { Component, type ReactNode } from "react";
import { Box, Heading, Text } from "@chakra-ui/react";
import { Button } from "./ui/button";

export default class PageFailed extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error("page failed", error); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Box flex="1" display="flex" alignItems="center" justifyContent="center" px={4} py={16} data-testid="page-failed" role="alert">
        <Box maxW="md" textAlign="center">
          <Heading size="md" mb={2}>This page could not be opened</Heading>
          <Text color="fg.muted" mb={6}>RoleMatch may have just been updated. Reloading opens the latest version.</Text>
          <Button onClick={() => window.location.reload()}>Reload</Button>
        </Box>
      </Box>
    );
  }
}
