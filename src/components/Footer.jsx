import React from 'react';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import {
  Box,
  Container,
  SimpleGrid,
  Stack,
  Text,
  Flex,
  Heading,
  Link,
  Icon,
  Input,
  HStack,
  VStack} from '@chakra-ui/react';
import { Image } from './ui/image';
import { Button } from './ui/button';
import { useColorModeValue } from '../theme/color-mode';
import { InputGroup } from './ui/input-group';
import { 
  FiGithub, 
  FiTwitter, 
  FiLinkedin, 
  FiYoutube, 
  FiMail, 
  FiArrowRight, 
  FiExternalLink, 
  FiCheck,
  FiChevronRight
} from 'react-icons/fi';

// The public pages, where the footer also invites a visitor in (owner, 11 Nov 2026: "tailor a few things that should only be showing up on the
// landing page"). Everywhere else, signed in or signing in, the footer is the same without the newsletter and the Get Started strip.
const SITE_PAGES = ['/', '/features', '/pricing', '/contact'];
// Pages of this site the footer can lead to; a name not here stays as it was until those pages exist.
const PAGE = { Features: '/features', Pricing: '/pricing', Contact: '/contact' };

/** The one footer, placed by the page frame (main.jsx) under every page, so no page can be without it (owner and his father, 10 Nov 2026: "persistent
 *  on every page, similar to how a website behaves"). It scrolls with the page and is never pinned over it. */
export function PageFooter() {
  const { pathname } = useLocation();
  return <Footer site={SITE_PAGES.includes(pathname)} />;
}

const Footer = ({ site = true }) => {
  // Color scheme based on theme
  const bg = useColorModeValue('white', 'gray.900');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const footerBg = useColorModeValue('gray.50', 'gray.900');
  const textColor = useColorModeValue('gray.600', 'gray.400');
  const headingColor = useColorModeValue('gray.700', 'white');
  const linkHoverColor = useColorModeValue('blue.500', 'blue.300');
  const accentColor = useColorModeValue('blue.500', 'blue.300');
  const logoSrc = useColorModeValue('/images/logo-dark.svg', '/images/logo-light.svg');
  
  // Year for copyright
  const currentYear = new Date().getFullYear();
  
  return (
    <Box as="footer" bg={footerBg} color={textColor} borderTopWidth="1px" borderColor={borderColor} data-testid="site-footer" data-footer={site ? 'site' : 'app'}>
      {/* Main Footer Content */}
      <Container as={Stack} maxW="container.xl" py={10}>
        <SimpleGrid columns={{ base: 1, sm: 2, md: site ? 5 : 4 }} gap={8}>
          {/* Company Info */}
          <Stack gap={6}>
            <Box>
              <Image src={useColorModeValue("/logo-light.png", "/logo-dark.png")} alt="RoleMatch" height="40px" />
            </Box>
            <Text fontSize="sm">
              RoleMatch simplifies talent acquisition and management with AI-powered matching and analytics.
            </Text>
            
            {/* Social Media Links */}
            <HStack gap={4}>
              {[
                { label: 'Twitter', icon: FiTwitter, href: '#' },
                { label: 'LinkedIn', icon: FiLinkedin, href: '#' },
                { label: 'YouTube', icon: FiYoutube, href: '#' },
                { label: 'GitHub', icon: FiGithub, href: '#' }
              ].map((social) => (
                <Link 
                  key={social.label}
                  href={social.href}
                  target="_blank"
                  rel="noopener"
                  aria-label={social.label}
                  _hover={{ color: linkHoverColor }}
                >
                  <Icon as={social.icon} boxSize={5} />
                </Link>
              ))}
            </HStack>
          </Stack>
          
          {/* Product */}
          <Stack align="flex-start">
            <Heading as="h3" fontSize="md" color={headingColor} mb={3}>
              Product
            </Heading>
            {['Features', 'Use Cases', 'Integrations', 'Pricing', 'Roadmap'].map((text) => (
              <Link 
                key={text} 
                {...(PAGE[text] ? { asChild: true } : { href: "#" })} 
                fontSize="sm"
                _hover={{ color: linkHoverColor }}
                display="flex"
                alignItems="center"
              >
                {PAGE[text] ? <RouterLink to={PAGE[text]}><Icon as={FiChevronRight} boxSize={3.5} mr={1.5} opacity={0.7} />{text}</RouterLink> : <><Icon as={FiChevronRight} boxSize={3.5} mr={1.5} opacity={0.7} />{text}</>}
              </Link>
            ))}
          </Stack>
          
          {/* Company */}
          <Stack align="flex-start">
            <Heading as="h3" fontSize="md" color={headingColor} mb={3}>
              Company
            </Heading>
            {['About', 'Careers', 'Blog', 'Press', 'Contact'].map((text) => (
              <Link 
                key={text} 
                {...(PAGE[text] ? { asChild: true } : { href: "#" })} 
                fontSize="sm"
                _hover={{ color: linkHoverColor }}
                display="flex"
                alignItems="center"
              >
                {PAGE[text] ? <RouterLink to={PAGE[text]}><Icon as={FiChevronRight} boxSize={3.5} mr={1.5} opacity={0.7} />{text}</RouterLink> : <><Icon as={FiChevronRight} boxSize={3.5} mr={1.5} opacity={0.7} />{text}</>}
              </Link>
            ))}
          </Stack>
          
          {/* Resources */}
          <Stack align="flex-start">
            <Heading as="h3" fontSize="md" color={headingColor} mb={3}>
              Resources
            </Heading>
            {['Documentation', 'Guides', 'API Reference', 'Community', 'Help Center'].map((text) => (
              <Link 
                key={text} 
                {...(PAGE[text] ? { asChild: true } : { href: "#" })} 
                fontSize="sm"
                _hover={{ color: linkHoverColor }}
                display="flex"
                alignItems="center"
              >
                {PAGE[text] ? <RouterLink to={PAGE[text]}><Icon as={FiChevronRight} boxSize={3.5} mr={1.5} opacity={0.7} />{text}</RouterLink> : <><Icon as={FiChevronRight} boxSize={3.5} mr={1.5} opacity={0.7} />{text}</>}
              </Link>
            ))}
          </Stack>
          
          {/* Newsletter: public pages only */}
          {site && <Stack align="flex-start" gap={5}>
            <Heading as="h3" fontSize="md" color={headingColor}>
              Stay Updated
            </Heading>
            <Text fontSize="sm">
              Subscribe to our newsletter for product updates, industry insights and more.
            </Text>
            
            <InputGroup size="md" endElementProps={{ width: "4.5rem" }} endElement={
                <Button tone={accentColor} 
                  h="1.75rem" 
                  size="sm"
                  mr={1}
                >
                  <Icon as={FiArrowRight} />
                </Button>
              }>
              <Input
                placeholder="Your email"
                bg={bg}
                border={1}
                borderColor={borderColor}
                _hover={{
                  borderColor: linkHoverColor
                }}
                _focus={{
                  borderColor: accentColor,
                }}
                _focusVisible={{ zIndex: 1, borderColor: accentColor, boxShadow: `0 0 0 1px {colors.${accentColor}}` }}
                type="email"
              />
            </InputGroup>
            
            <HStack gap={2} fontSize="xs">
              <Icon as={FiCheck} color={accentColor} />
              <Text>We respect your privacy</Text>
            </HStack>
          </Stack>}
        </SimpleGrid>
      </Container>
      
      {/* Highlighted Features or CTA: public pages only */}
      {site && <Box py={6} borderTopWidth={1} borderBottomWidth={1} borderColor={borderColor}>
        <Container maxW="container.xl">
          <Flex 
            direction={{ base: 'column', md: 'row' }} 
            align={{ base: 'flex-start', md: 'center' }}
            justify="space-between"
            gap={4}
          >
            <Stack direction="row" gap={{ base: 4, md: 8 }} flex="3">
              {[
                { label: 'Enterprise', description: 'Custom solutions for large organizations' },
                { label: 'Free Trial', description: '14-day full access to all features' },
                { label: 'AI Matching', description: 'Industry-leading match technology' },
              ].map((feature) => (
                <VStack key={feature.label} align="flex-start" gap={0} maxW="160px">
                  <Text fontWeight="bold" fontSize="sm" color={headingColor}>
                    {feature.label}
                  </Text>
                  <Text fontSize="xs">{feature.description}</Text>
                </VStack>
              ))}
            </Stack>
            
            <Button 
              to="/overview"
              colorPalette="blue"
              size="sm"
              rightIcon={<FiExternalLink />}
            >
              Get Started
            </Button>
          </Flex>
        </Container>
      </Box>}
      
      {/* Bottom Bar with Copyright, Trust Badges and Legal Links */}
      <Box py={4} bg={useColorModeValue('gray.100', 'gray.800')}>
        <Container maxW="container.xl">
          <Stack
            direction={{ base: 'column', md: 'row' }}
            gap={4}
            align={{ base: 'center', md: 'center' }}
            justify="space-between"
          >
            <Text fontSize="sm">
              © {currentYear} RoleMatch. All rights reserved.
            </Text>
            
            {/* Trust Badges */}
            <HStack gap={4} justify="center">
              {['SOC 2', 'GDPR Compliant', 'ISO 27001'].map((badge) => (
                <Box 
                  key={badge}
                  px={2}
                  py={1}
                  borderRadius="md"
                  bg={useColorModeValue('white', 'gray.700')}
                  fontSize="xs"
                  fontWeight="medium"
                  border="1px solid"
                  borderColor={borderColor}
                >
                  {badge}
                </Box>
              ))}
            </HStack>
            
            {/* Legal Links */}
            <HStack gap={6} fontSize="sm">
              {['Terms', 'Privacy', 'Cookies'].map((link) => (
                <Link key={link} _hover={{ color: linkHoverColor }}>
                  {link}
                </Link>
              ))}
            </HStack>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
};
