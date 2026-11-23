import {
  Box,
  Heading,
  Input,
  VStack,
  Text,
  HStack,
  Field,
  Separator,
  Flex,
} from '@chakra-ui/react'
import { Image } from '../components/ui/image'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { useColorMode, useColorModeValue } from '../theme/color-mode'
import { Button } from '../components/ui/button'
import { IconButton } from '../components/ui/icon-button'
import { InputGroup } from '../components/ui/input-group'
import { toaster } from '../components/ui/toaster'
import { Tooltip } from '../components/ui/tooltip'
import Animation from '@/components/Animation'
import { FcGoogle } from 'react-icons/fc'
import { FaApple, FaTwitter, FaEnvelope, FaLock, FaArrowRight } from 'react-icons/fa'
import { MoonIcon, SunIcon } from '../components/ui/icons'
import { api } from '../api/client'
import { assertPasskey, passkeyCancelled, passkeysSupported } from '../utils/passkeys'
import { FIRST_PERIOD, warmPortal } from '../utils/warm'

export default function LoginPage() {
  // All useState hooks
  const [email, setEmail] = useState('')
  const [step, setStep] = useState('email')
  const [code, setCode] = useState('')
  const [timer, setTimer] = useState(0)
  const [intervalId, setIntervalId] = useState(null)
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [resetBusy, setResetBusy] = useState(false)

  // All useRef hooks
  const codeInputRef = useRef(null)

  // All custom hooks - these must be called in the same order every render
  const navigate = useNavigate()
  const inviteToken = useSearchParams()[0].get('invite') || ''
  const sessionEnded = useSearchParams()[0].get('ended') === '1'   // sent here after a session ran its full length (8 hours from signing in)
  const { colorMode, toggleColorMode } = useColorMode()

  // All color mode values - collect ALL useColorModeValue hooks here
  const glowColor = useColorModeValue('blue.300', 'blue.700')
  const cardBg = useColorModeValue('white', 'gray.800')
  const textColor = useColorModeValue('gray.800', 'white')
  const inputBg = useColorModeValue('gray.50', 'gray.700')
  const socialBg = useColorModeValue('white', 'gray.800')
  const socialBorder = useColorModeValue('gray.200', 'whiteAlpha.200')
  const appleIconColor = useColorModeValue('#111111', '#FFFFFF')
  const bgColor = useColorModeValue('#f7f9fc', '#0a0f1c')
  const hoverBorderColor = useColorModeValue('gray.300', 'gray.600')
  const focusBgColor = useColorModeValue('white', 'gray.800')
  const blueBgColor = useColorModeValue('blue.50', 'blue.900')
  const blueBorderColor = useColorModeValue('blue.400', 'blue.500')
  const blueTextColor = useColorModeValue('blue.700', 'blue.200')
  const blueSubtextColor = useColorModeValue('blue.600', 'blue.300')
  const ghostButtonColor = useColorModeValue('blue.600', 'blue.300')
  const iconButtonColor = useColorModeValue('gray.600', 'gray.400')
  const mediumTextColor = useColorModeValue('gray.600', 'gray.300')

  // Constants (non-hooks, can be anywhere)

  useEffect(() => {
    if (timer === 0 && intervalId) {
      clearInterval(intervalId)
    }
  }, [timer, intervalId])

  const startCountdown = useCallback(() => {
    if (intervalId) clearInterval(intervalId)
    setTimer(60)
    const id = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          clearInterval(id)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    setIntervalId(id)
  }, [intervalId, setTimer, setIntervalId])

  useEffect(() => {
    if (step === 'code' && timer > 0) {
      const id = setInterval(() => {
        setTimer(prevTimer => {
          if (prevTimer <= 1) {
            clearInterval(id)
            return 0
          }
          return prevTimer - 1
        })
      }, 1000)
      return () => clearInterval(id)
    }
  }, [step, timer])

  useEffect(() => {
    if (step === 'code' && codeInputRef.current) {
      // Short timeout to ensure component is fully rendered
      setTimeout(() => {
        codeInputRef.current.focus()
      }, 50)
    }
  }, [step])

  // A forgotten password: ask for a code, then enter it with a new password. The page says the same thing whether or not the address has an account.
  const say = (title, description, type = 'info') => toaster.create({ title, description, type, closable: true })
  const askForReset = async () => {
    setResetBusy(true)
    try { await api.forgotPassword(email.trim()); setResetCode(''); setNewPassword(''); setStep('reset'); say('Check your email', 'If that address has a RoleMatch account, a reset code is on its way.') }
    catch (e) { say('Could not ask for a code', e?.message ?? 'Please try again shortly.', 'error') }
    finally { setResetBusy(false) }
  }
  const finishReset = async () => {
    setResetBusy(true)
    try { await api.resetPassword(email.trim(), resetCode.trim(), newPassword); setCode(''); setResetCode(''); setNewPassword(''); setStep('code'); say('Password changed', 'Sign in with your new password. Any other sessions have been signed out.', 'success') }
    catch (e) { say('Password not changed', e?.message ?? 'Please try again.', 'error') }
    finally { setResetBusy(false) }
  }

  const handleSendCode = useCallback(() => {
    // More comprehensive email validation
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(email)) {
      toaster.create({
        title: 'Invalid Email Format',
        description: 'Please enter a valid email address',
        type: 'warning',
        closable: true,
      })
      return
    }

    setStep('code')
    setCode('')
  }, [email, setStep, setCode])

  // Offered only where this environment has passkeys switched on and this browser can use them. The password always remains.
  const [passkeyOffered, setPasskeyOffered] = useState(false)
  useEffect(() => { if (passkeysSupported()) api.authMethods().then((m) => setPasskeyOffered(m.passkey)).catch(() => {}) }, [])
  const handlePasskey = useCallback(async () => {
    try {
      const { challengeId, options } = await api.passkeySignInOptions()
      const { user } = await api.passkeySignIn(challengeId, await assertPasskey(options))
      try { sessionStorage.setItem('th_welcome_back', '1') } catch { /* optional */ }
      // The Live portal starts loading now, under the loading screen the Overview shows, rather than after the page has drawn.
      if (!inviteToken) void warmPortal(FIRST_PERIOD, user?.userId)
      navigate(inviteToken ? `/accept-invite?token=${encodeURIComponent(inviteToken)}` : '/overview')
    } catch (error) {
      if (passkeyCancelled(error)) { toaster.create({ title: 'Passkey sign-in cancelled', description: 'You can try again, or continue with your e-mail and password.', type: 'info', closable: true }); return }
      toaster.create({ title: 'Could not sign in with a passkey', description: error.status ? error.message : 'Your device could not complete this. Continue with your e-mail and password.', type: 'error', closable: true })
    }
  }, [navigate, inviteToken])

  const handleVerify = useCallback(async () => {
    try {
      const { user } = await api.login(email, code)
      try { sessionStorage.setItem('th_welcome_back', '1') } catch { /* optional */ }
      // The Live portal starts loading now, under the loading screen the Overview shows, rather than after the page has drawn.
      if (!inviteToken) void warmPortal(FIRST_PERIOD, user?.userId)
      navigate(inviteToken ? `/accept-invite?token=${encodeURIComponent(inviteToken)}` : '/overview')
    } catch (error) {
      toaster.create({
        title: error.status === 429 ? 'Too many attempts' : error.status === 403 ? 'Confirm your email first' : 'Could not sign in',
        description: error.status === 429 || error.status === 401 || error.status === 403 ? error.message : 'The server could not be reached. Please try again.',
        type: 'error',
        closable: true,
      })
    }
  }, [code, email, navigate, inviteToken])



  return (
    <Box
      minH="100vh"
      bg={bgColor}
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      position="relative"
      overflow="hidden"
    >
      {/* Background glow */}
      <Box
        position="absolute"
        top="50%"
        left="50%"
        transform="translate(-50%, -50%)"
        w="700px"
        h="700px"
        bg={glowColor}
        opacity={0.35}
        filter="blur(160px)"
        zIndex={0}
        borderRadius="full"
      />

      {/* No top logo as requested */}

      {/* Login card */}
      <Box
        maxW="md"
        w="full"
        p={8}
        bg={cardBg}
        borderRadius="xl"
        boxShadow="xl"
        position="relative"
        zIndex={1}
        mx={4}
        textAlign="center"
      >
        {/* Blue accent bar */}
        <Box 
          position="absolute" 
          top="0" 
          left="0" 
          right="0" 
          height="4px" 
          bgImage="linear-gradient(to right, {colors.blue.400}, {colors.teal.400})"
          borderTopRadius="xl"
        />

        <VStack gap={6} align="center">
          <Heading size="lg" color={textColor} fontWeight="bold">
            Welcome Back
          </Heading>
          {sessionEnded && (
            <Text role="status" fontSize="sm" textAlign="center" color={textColor} mt={-3}>
              Your session ended. Log in to carry on; everything you saved is kept.
            </Text>
          )}

          <VStack gap={6} align="center" width="full">
            <Tooltip content="Return to homepage" positioning={{ placement: "top" }}>
              <Box asChild display="inline-block"><Link to="/">
                <Image
                  src={useColorModeValue('/logo-light.png', '/logo-dark.png')}
                  alt="RoleMatch"
                  height="36px"
                  mb={1}
                  mx="auto"
                  opacity="0.9"
                  filter="saturate(0.9)"
                  transition="all 0.2s ease"
                  _hover={{ 
                    transform: 'scale(1.05)', 
                    opacity: 1,
                    filter: 'saturate(1)'
                  }}
                  cursor="pointer"
                />
              </Link></Box>
            </Tooltip>
            <Text fontSize="sm" fontWeight="medium" color={iconButtonColor} textAlign="center">
              Your gateway to exceptional talent
            </Text>
          </VStack>

          {step === 'email' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}>
              <VStack w="full" align="stretch" gap={4} as="form" onSubmit={(e) => {
                e.preventDefault();
                handleSendCode();
              }}>
                <Field.Root required>
                  <Field.Label fontSize="sm" fontWeight="medium" textAlign="center" width="100%" mb={2}>
                    Email Address
                  <Field.RequiredIndicator /></Field.Label>
                  <InputGroup size="md" endElement={
                      <Box color={email.length > 0 && !email.includes('@') ? "red.500" : "gray.400"}>
                        <FaEnvelope size={16} />
                      </Box>
                  }>
                    <Input
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      bg={inputBg}
                      size="md"
                      borderRadius="md"
                      pr="4.5rem"
                      _hover={{ borderColor: hoverBorderColor }}
                      _focus={{ 
                        borderColor: '#007BA7', 
                        boxShadow: '0 0 0 1px #007BA7',
                        bg: focusBgColor
                      }}
                      autoComplete="email"
                      aria-label="Email Address"
                    />
                  </InputGroup>
                  {email.length > 0 && !email.includes('@') && (
                    <Text color="red.500" fontSize="xs" mt={1} textAlign="left">
                      Please enter a valid email address
                    </Text>
                  )}
                </Field.Root>

                <Button tone="#007BA7"
                  w="full"
                  type="submit"
                  rightIcon={<FaArrowRight />}
                  size="md"
                  fontWeight="medium"
                >
                  Continue
                </Button>
                {passkeyOffered && (
                  <VStack gap={1} w="full">
                    <Button type="button" variant="outline" w="full" size="md" fontWeight="medium" onClick={handlePasskey}>Sign in with a passkey</Button>
                    <Text fontSize="xs" color={mediumTextColor} textAlign="center">Uses Face ID, Touch ID, Windows Hello or a device PIN, if your device has them.</Text>
                  </VStack>
                )}
                <Text fontSize="sm" color={mediumTextColor}>New to RoleMatch? <Box asChild color="#007BA7" fontWeight="semibold"><Link to="/signup">Create an account</Link></Box></Text>


              </VStack>
            </motion.div>
          )}

          {step === 'forgot' && (
            <VStack w="full" align="stretch" gap={4} as="form" onSubmit={(e) => { e.preventDefault(); void askForReset() }}>
              <Text fontSize="sm" color={mediumTextColor}>We'll send a code to this address so you can choose a new password.</Text>
              <Field.Root required><Field.Label fontSize="sm" fontWeight="medium">Email<Field.RequiredIndicator /></Field.Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} bg={inputBg} autoComplete="email" aria-label="Email for the reset code" autoFocus />
              </Field.Root>
              <Button tone="#007BA7" w="full" type="submit" size="md" fontWeight="medium" disabled={resetBusy}>Send reset code</Button>
              <Button variant="ghost" color={ghostButtonColor} fontSize="sm" fontWeight="medium" onClick={() => setStep('code')}>Back to sign in</Button>
            </VStack>
          )}
          {step === 'reset' && (
            <VStack w="full" align="stretch" gap={4} as="form" onSubmit={(e) => { e.preventDefault(); void finishReset() }}>
              <Text fontSize="sm" color={mediumTextColor}>If <strong>{email}</strong> has a RoleMatch account, a code is on its way. It can be used once. Check your spam folder too.</Text>
              <Field.Root required><Field.Label fontSize="sm" fontWeight="medium">Reset code<Field.RequiredIndicator /></Field.Label>
                <Input value={resetCode} onChange={(e) => setResetCode(e.target.value)} bg={inputBg} inputMode="numeric" autoComplete="one-time-code" aria-label="Reset code" autoFocus />
              </Field.Root>
              <Field.Root required><Field.Label fontSize="sm" fontWeight="medium">New password<Field.RequiredIndicator /></Field.Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} bg={inputBg} autoComplete="new-password" aria-label="New password" minLength={12} maxLength={128} />
                <Field.HelperText fontSize="xs">At least 12 characters.</Field.HelperText>
              </Field.Root>
              <Button tone="#007BA7" w="full" type="submit" size="md" fontWeight="medium" disabled={resetBusy}>Change password</Button>
              <Button variant="ghost" color={ghostButtonColor} fontSize="sm" fontWeight="medium" disabled={resetBusy} onClick={() => void askForReset()}>Send a new code</Button>
              <Button variant="ghost" color={ghostButtonColor} fontSize="sm" fontWeight="medium" onClick={() => setStep('code')}>Back to sign in</Button>
            </VStack>
          )}
          {step === 'code' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}>
              <VStack w="full" align="stretch" gap={4} as="form" onSubmit={(e) => {
                e.preventDefault();
                handleVerify();
              }}>
                <Box
                  py={3}
                  px={4}
                  bg={blueBgColor}
                  borderRadius="md"
                  width="full"
                  borderLeft="3px solid"
                  borderColor={blueBorderColor}
                >
                  <VStack align="start" gap={1}>
                    <Text fontSize="sm" fontWeight="medium" color={blueTextColor}>
                      Signing in as <strong>{email}</strong>
                    </Text>
                  </VStack>
                </Box>

                <Field.Root required>
                  <Field.Label fontSize="sm" fontWeight="medium" textAlign="center" width="100%" mb={2}>Password<Field.RequiredIndicator /></Field.Label>
                  <InputGroup endElement={
                      <Box color="gray.400">
                        <FaLock size={16} />
                      </Box>
                  }>
                    <Input
                      type="password"
                      placeholder="Your password"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      bg={inputBg}
                      size="md"
                      borderRadius="md"
                      autoComplete="current-password"
                      aria-label="Password"
                      ref={codeInputRef}
                      autoFocus
                      _hover={{ borderColor: hoverBorderColor }}
                      _focus={{ 
                        borderColor: '#007BA7', 
                        boxShadow: '0 0 0 1px #007BA7',
                        bg: focusBgColor
                      }}
                      // onKeyPress is not needed as the form handles Enter key with onSubmit
                    />
                  </InputGroup>
                </Field.Root>

                <Button tone="#007BA7"
                  w="full"
                  type="submit"
                  size="md"
                  fontWeight="medium"
                >
                  Sign In
                </Button>

                <Button variant="ghost" color={ghostButtonColor} fontSize="sm" fontWeight="medium" onClick={() => setStep('forgot')}>
                  Forgot your password?
                </Button>
                <Button variant="ghost" color={ghostButtonColor} fontSize="sm" fontWeight="medium" onClick={() => { setStep('email'); setCode('') }}>
                  Use a different email
                </Button>
                <Text fontSize="sm" color={mediumTextColor}>New to RoleMatch? <Box asChild color="#007BA7" fontWeight="semibold"><Link to="/signup">Create an account</Link></Box></Text>
              </VStack>
            </motion.div>
          )}
        </VStack>
      </Box>

      {/* Animation */}
      <Box mt={8} w="180px" zIndex={1} opacity={0.9}>
        <Animation
          autoplay
          loop
          src="/animations/login-animation.json"
          style={{ width: '100%', height: '100%' }}
        />
      </Box>
      
      {/* Color mode toggle */}
      <Tooltip content={colorMode === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'} positioning={{ placement: "right" }}>
        <IconButton
          aria-label="Toggle color mode"
          position="absolute"
          top="4"
          left="4"
          size="md"
          variant="ghost"
          color={iconButtonColor}
          onClick={toggleColorMode}
          zIndex={2}>{colorMode === 'light' ? <MoonIcon /> : <SunIcon />}</IconButton>
      </Tooltip>

    </Box>
  )
}
