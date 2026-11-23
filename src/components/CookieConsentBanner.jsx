import React, { useState, useEffect } from 'react';
import {
  Box,
  Text,
  Flex,
  Stack,
  Heading,
  Field,
  Dialog,
  Portal,
  useDisclosure,
  Separator,
  Link
} from '@chakra-ui/react';
import { useColorModeValue } from '../theme/color-mode';
import { Button } from './ui/button';
import { DialogCloseButton, DialogHeader } from './ui/dialog';
import { Switch } from './ui/switch';
import { 
  getConsentSettings, 
  saveConsentSettings, 
  hasConsentChoice, 
  COOKIE_CATEGORIES,
  acceptAllCookies,
  acceptEssentialCookies
} from '../utils/cookieManager';

/**
 * Cookie Consent Banner Component
 * 
 * Displays a GDPR/CCPA compliant cookie consent banner with options for users
 * to manage their cookie preferences.
 */
const CookieConsentBanner = () => {
  // Get color mode values for theming
  const bgColor = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const textColor = useColorModeValue('gray.700', 'gray.300');
  const accentColor = useColorModeValue('#007BA7', '#3EAED8');
  
  // Track visibility of the banner
  const [showBanner, setShowBanner] = useState(false);
  
  // State for cookie preferences modal
  const { open: isOpen, onOpen, onClose } = useDisclosure();
  
  // Cookie consent settings state
  const [consentSettings, setConsentSettings] = useState({
    [COOKIE_CATEGORIES.ESSENTIAL]: true, // Always enabled
    [COOKIE_CATEGORIES.FUNCTIONAL]: false,
    [COOKIE_CATEGORIES.ANALYTICS]: false,
    [COOKIE_CATEGORIES.MARKETING]: false
  });
  
  // Load existing cookie settings on mount
  useEffect(() => {
    const storedSettings = getConsentSettings();
    setConsentSettings({
      ...consentSettings,
      ...storedSettings
    });
    
    // Show banner if user has not made a choice yet
    setShowBanner(!hasConsentChoice());
  }, []);
  
  // Handle accepting all cookies
  const handleAcceptAll = () => {
    acceptAllCookies();
    setShowBanner(false);
    if (isOpen) onClose();
  };
  
  // Handle accepting only essential cookies
  const handleAcceptEssential = () => {
    acceptEssentialCookies();
    setShowBanner(false);
    if (isOpen) onClose();
  };
  
  // Handle saving custom preferences
  const handleSavePreferences = () => {
    saveConsentSettings(consentSettings);
    setShowBanner(false);
    onClose();
  };
  
  // Update individual cookie category toggle
  const handleToggleChange = (category) => {
    setConsentSettings({
      ...consentSettings,
      [category]: !consentSettings[category]
    });
  };
  
  if (!showBanner && !isOpen) {
    return null;
  }
  
  return (
    <>
      {/* Main cookie consent banner */}
      {showBanner && (
        <Box
          position="fixed"
          bottom="0"
          left="0"
          right="0"
          zIndex="banner"
          p={4}
          bg={bgColor}
          borderTop="1px solid"
          borderColor={borderColor}
          boxShadow="lg"
        >
          <Box maxW="7xl" mx="auto">
            <Flex 
              direction={{ base: 'column', md: 'row' }} 
              justify="space-between" 
              align={{ base: 'flex-start', md: 'center' }}
              gap={4}
            >
              <Stack gap={2} flex="1">
                <Heading as="h3" size="sm">Privacy Settings</Heading>
                <Text fontSize="sm" color={textColor}>
                  We use cookies to enhance your browsing experience, analyze site traffic, and personalize content.
                  By clicking "Accept All", you consent to our use of cookies.
                </Text>
                <Link fontSize="xs" color={accentColor} onClick={onOpen}>
                  Customize preferences
                </Link>
              </Stack>
              
              <Stack direction={{ base: 'column', sm: 'row' }} gap={3} mt={{ base: 2, md: 0 }}>
                <Button tone="#007BA7" 
                  variant="outline" 
                  size="sm" 
                  onClick={handleAcceptEssential}
                >
                  Essential Only
                </Button>
                <Button tone="#007BA7"
                  size="sm" 
                  onClick={handleAcceptAll}
                >
                  Accept All
                </Button>
              </Stack>
            </Flex>
          </Box>
        </Box>
      )}
      
      {/* Detailed cookie preferences modal */}
      <Dialog.Root open={isOpen} onOpenChange={(e) => { if (!e.open) onClose(); }} size="lg" scrollBehavior="inside">
        <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
        <Dialog.Content>
          <DialogHeader borderBottom="1px solid" borderColor={borderColor}>
            Cookie Preferences
          </DialogHeader>
          <DialogCloseButton />
          
          <Dialog.Body py={4}>
            <Stack gap={5}>
              <Text fontSize="sm">
                Manage your cookie preferences. Essential cookies are necessary for the website to function properly and cannot be disabled.
              </Text>
              
              {/* Essential cookies - always enabled */}
              <Field.Root display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Field.Label htmlFor="essential-cookies" mb={0} fontWeight="semibold">
                    Essential Cookies
                  </Field.Label>
                  <Text fontSize="xs" color={textColor}>
                    Required for core site functionality. Cannot be disabled.
                  </Text>
                </Box>
                <Switch 
                  id="essential-cookies" 
                  checked={true} 
                  disabled={true}
                  colorPalette="blue"
                />
              </Field.Root>
              
              <Separator />
              
              {/* Functional cookies */}
              <Field.Root display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Field.Label htmlFor="functional-cookies" mb={0} fontWeight="semibold">
                    Functional Cookies
                  </Field.Label>
                  <Text fontSize="xs" color={textColor}>
                    Enable personalized features and remember your preferences.
                  </Text>
                </Box>
                <Switch 
                  id="functional-cookies" 
                  checked={consentSettings[COOKIE_CATEGORIES.FUNCTIONAL]} 
                  onCheckedChange={() => handleToggleChange(COOKIE_CATEGORIES.FUNCTIONAL)}
                  colorPalette="blue"
                />
              </Field.Root>
              
              <Separator />
              
              {/* Analytics cookies */}
              <Field.Root display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Field.Label htmlFor="analytics-cookies" mb={0} fontWeight="semibold">
                    Analytics Cookies
                  </Field.Label>
                  <Text fontSize="xs" color={textColor}>
                    Help us improve our website by collecting anonymous usage information.
                  </Text>
                </Box>
                <Switch 
                  id="analytics-cookies" 
                  checked={consentSettings[COOKIE_CATEGORIES.ANALYTICS]} 
                  onCheckedChange={() => handleToggleChange(COOKIE_CATEGORIES.ANALYTICS)}
                  colorPalette="blue"
                />
              </Field.Root>
              
              <Separator />
              
              {/* Marketing cookies */}
              <Field.Root display="flex" alignItems="center" justifyContent="space-between">
                <Box>
                  <Field.Label htmlFor="marketing-cookies" mb={0} fontWeight="semibold">
                    Marketing Cookies
                  </Field.Label>
                  <Text fontSize="xs" color={textColor}>
                    Used to track visitors across websites to display relevant advertisements.
                  </Text>
                </Box>
                <Switch 
                  id="marketing-cookies" 
                  checked={consentSettings[COOKIE_CATEGORIES.MARKETING]} 
                  onCheckedChange={() => handleToggleChange(COOKIE_CATEGORIES.MARKETING)}
                  colorPalette="blue"
                />
              </Field.Root>
            </Stack>
          </Dialog.Body>
          
          <Dialog.Footer borderTop="1px solid" borderColor={borderColor}>
            <Button tone="#007BA7" 
              variant="outline" 
              mr={3} 
              onClick={handleAcceptEssential}
            >
              Essential Only
            </Button>
            <Button tone="#007BA7"
              mr={3} 
              onClick={handleAcceptAll}
            >
              Accept All
            </Button>
            <Button tone="#007BA7"
              onClick={handleSavePreferences}
            >
              Save Preferences
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
        </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
    </>
  );
};

export default CookieConsentBanner;
