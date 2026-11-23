import {
  Box,
  Flex,
  HStack,
  useDisclosure,
  Stack,
  Link as ChakraLink,
} from '@chakra-ui/react'
import { Image } from './ui/image'
import { useColorMode, useColorModeValue } from '../theme/color-mode'
import { Button } from './ui/button'
import { IconButton } from './ui/icon-button'
import { HamburgerIcon, CloseIcon, MoonIcon, SunIcon } from './ui/icons'
import { Tooltip } from './ui/tooltip'
import { useEffect, useState } from 'react'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import { FiArrowRight } from 'react-icons/fi'

// On hover the arrow eases forward with the takeover (same 0.4 s timing as src/theme/recipes.ts), an invitation without any bounce
const arrowNudge = {
  '& .chakra-button__icon': { transition: 'transform 0.4s cubic-bezier(0.65, 0, 0.35, 1)' },
  '&:hover .chakra-button__icon': { transform: 'translateX(3px)' },
  '@media (prefers-reduced-motion: reduce)': { '& .chakra-button__icon': { transition: 'none' } },
}

// Each link's accent comes from the hero's own words (Discover, hire, match, talent), so the bar under a link echoes the page below it.
const Links = [
  { name: 'Home', path: '/', accent: '#f0715a' },
  { name: 'Features', path: '/features', accent: '#3dbb8b' },
  { name: 'Pricing', path: '/pricing', accent: '#e3bd3a' },
  { name: 'Contact', path: '/contact', accent: '#8b7cf6' },
]

// Text that brightens, a faint glass pill, and a thin bar in the link's accent that grows from the centre on hover.
// The current page keeps a short bar (and aria-current), so people can see where they are.
const NavLink = ({ link }) => {
  const { pathname } = useLocation()
  const current = link.path === '/' ? pathname === '/' : pathname.startsWith(link.path)
  const rest = useColorModeValue('gray.600', 'whiteAlpha.800')
  const lit = useColorModeValue('gray.900', 'white')
  const glass = useColorModeValue('blackAlpha.50', 'whiteAlpha.100')

  return (
    <ChakraLink
      asChild
      position="relative"
      display="inline-flex"
      alignItems="center"
      h={9}
      px={4}
      fontSize="sm"
      fontWeight={current ? 'semibold' : 'medium'}
      letterSpacing="0.01em"
      borderRadius="full"
      color={current ? lit : rest}
      css={{ '--accent': link.accent }}
      transition="color 0.2s ease, background-color 0.2s ease"
      _hover={{ color: lit, bg: glass, textDecoration: 'none', _after: { w: 'calc(100% - 2rem)' } }}
      _focusVisible={{ outline: '2px solid', outlineColor: 'var(--accent)', outlineOffset: '2px' }}
      _after={{
        content: '""',
        position: 'absolute',
        left: '50%',
        bottom: '5px',
        h: '2px',
        w: current ? '14px' : '0px',
        borderRadius: 'full',
        bg: 'var(--accent)',
        boxShadow: '0 0 8px var(--accent)',
        transform: 'translateX(-50%)',
        transition: 'width 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
      }}
      _motionReduce={{ transition: 'none', _after: { transition: 'none' } }}
    >
      <RouterLink to={link.path} aria-current={current ? 'page' : undefined}>
        {link.name}
      </RouterLink>
    </ChakraLink>
  )
}

export default function Navbar() {
  const { open: isOpen, onOpen, onClose } = useDisclosure()
  const { colorMode, toggleColorMode } = useColorMode()
  const bg = useColorModeValue('white', 'gray.800')
  const [scrolled, setScrolled] = useState(false)
  
  // Transparent background initially, solid bg color after scrolling
  const bgColor = useColorModeValue(
    scrolled ? 'rgba(255, 255, 255, 0.9)' : 'transparent',
    scrolled ? 'rgba(26, 32, 44, 0.9)' : 'transparent'
  )
  
  // Shadow only appears when scrolled
  const boxShadow = scrolled ? 'md' : 'none'
  
  // Handle scroll events
  useEffect(() => {
    const handleScroll = () => {
      // Change background when scrolled more than 80px
      if (window.scrollY > 80) {
        setScrolled(true)
      } else {
        setScrolled(false)
      }
    }
    
    window.addEventListener('scroll', handleScroll, { passive: true })
    
    // Check initial scroll position
    handleScroll()
    
    return () => {
      window.removeEventListener('scroll', handleScroll)
    }
  }, [])

  return (
    // On a phone the bar sits flush with the top edge: a floating pill leaves a strip above it where the page scrolls through.
    <Flex
      position="fixed"
      top={{ base: 0, md: 4 }}
      left={0}
      right={0}
      zIndex="999"
      mx="auto"
      maxW="7xl"
      px={4}
      backdropFilter={scrolled ? 'blur(10px)' : 'none'}
      bg={bgColor}
      rounded={{ base: 'none', md: 'full' }}
      boxShadow={boxShadow}
      align="center"
      justify="space-between"
      h="64px"
      transition="all 0.3s ease-in-out"
    >
      {/* Left: Theme toggle */}
      <HStack gap={4} flex="1" minW="0">
        <Tooltip
          content={colorMode === 'light' ? 'Dark mode' : 'Light mode'}
          positioning={{ placement: "bottom" }}
          showArrow
        >
          <IconButton
            size="md"
            onClick={toggleColorMode}
            aria-label="Toggle color mode"
            variant="ghost">{colorMode === 'light' ? <MoonIcon /> : <SunIcon />}</IconButton>
        </Tooltip>
        <HStack display={{ base: 'none', md: 'flex' }} gap={1}>
          {Links.map((link) => (
            <NavLink key={link.name} link={link} />
          ))}
        </HStack>
      </HStack>

      {/* Center: Logo */}
      <Box position="absolute" left="50%" transform="translateX(-50%)">
        <ChakraLink href="/" _hover={{ textDecoration: 'none' }}>
          <Image
            src={useColorModeValue('/logo-light.png', '/logo-dark.png')}
            alt="RoleMatch Logo"
            height="36px"
            objectFit="contain"
            filter="brightness(0.95) saturate(0.8)"
            style={{
              mixBlendMode: 'soft-light',
              transition: 'all 0.3s ease',
            }}
            _hover={{
              transform: 'scale(1.05)',
              opacity: 0.9,
            }}
          />
        </ChakraLink>
      </Box>

      {/* Right: Nav links + Login + Hamburger */}
      <HStack gap={4} flex="1" minW="0" justify="flex-end">
        {/* Sign up is the step we want a new visitor to take, so it is the bold one; Login stays easy to find but quiet */}
        <HStack display={{ base: 'none', md: 'flex' }} gap={2}>
          <Button to="/login" variant="ghost" size="sm" px={4}>
            Login
          </Button>
          <Button to="/signup" size="sm" px={5} tone="#007BA7" rightIcon={<FiArrowRight />} css={arrowNudge}>
            Sign up
          </Button>
        </HStack>

        <IconButton
          size="md"
          aria-label="Toggle Menu"
          display={{ base: 'flex', md: 'none' }}
          onClick={isOpen ? onClose : onOpen}
          variant="ghost">{isOpen ? <CloseIcon /> : <HamburgerIcon />}</IconButton>
      </HStack>

      {/* Mobile dropdown */}
      {isOpen && (
        <Box
          position="absolute"
          top="60px"
          left="0"
          right="0"
          bg={bg}
          borderBottomRadius="xl"
          shadow="lg"
          px={4}
          py={6}
          display={{ md: 'none' }}
        >
          <Stack as="nav" gap={4}>
            {Links.map((link) => (
              <NavLink key={link.name} link={link} />
            ))}
            <Button
              onClick={toggleColorMode}
              leftIcon={colorMode === 'light' ? <MoonIcon /> : <SunIcon />}
              variant="ghost"
              w="full"
            >
              Toggle {colorMode === 'light' ? 'Dark' : 'Light'} Mode
            </Button>
            <Button to="/signup" w="full" tone="#007BA7" rightIcon={<FiArrowRight />} css={arrowNudge}>
              Sign up
            </Button>
            <Button to="/login" w="full" variant="ghost">
              Login
            </Button>
          </Stack>
        </Box>
      )}
    </Flex>
  )
}
