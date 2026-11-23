import { Box, Heading, Input, VStack, Text, Field } from '@chakra-ui/react'
import { Image } from '../components/ui/image'
import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { motion } from 'motion/react'
import { useColorMode, useColorModeValue } from '../theme/color-mode'
import { Button } from '../components/ui/button'
import { IconButton } from '../components/ui/icon-button'
import { MoonIcon, SunIcon, ViewIcon, ViewOffIcon } from '../components/ui/icons'
import { InputGroup } from '../components/ui/input-group'
import { toaster } from '../components/ui/toaster'
import { api } from '../api/client'

const MIN_PASSWORD = 12

export default function SignupPage() {
  const [step, setStep] = useState('details') // details -> code
  const inviteToken = useSearchParams()[0].get('invite') || ''   // from an invitation e-mail: the address is fixed and no organisation is created
  const [invitation, setInvitation] = useState(null)
  const [form, setForm] = useState({ name: '', orgName: '', email: '', password: '', confirm: '', website: '' })
  useEffect(() => { if (inviteToken) api.invitation(inviteToken).then((i) => { setInvitation(i); setForm((f) => ({ ...f, email: i.email })) }).catch(() => setInvitation(false)) }, [inviteToken])
  const [code, setCode] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const codeRef = useRef(null)
  const navigate = useNavigate()
  const { colorMode, toggleColorMode } = useColorMode()

  const bgColor = useColorModeValue('#f7f9fc', '#0a0f1c')
  const glowColor = useColorModeValue('blue.300', 'blue.700')
  const cardBg = useColorModeValue('white', 'gray.800')
  const textColor = useColorModeValue('gray.800', 'white')
  const inputBg = useColorModeValue('gray.50', 'gray.700')
  const mutedColor = useColorModeValue('gray.600', 'gray.400')
  const logo = useColorModeValue('/logo-light.png', '/logo-dark.png')
  const noticeBg = useColorModeValue('blue.50', 'blue.900')
  const noticeText = useColorModeValue('blue.700', 'blue.200')

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const inputStyle = { bg: inputBg, size: 'md', borderRadius: 'md', _focus: { borderColor: '#007BA7', boxShadow: '0 0 0 1px #007BA7' } }

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(id)
  }, [cooldown])

  useEffect(() => { if (step === 'code') setTimeout(() => codeRef.current?.focus(), 50) }, [step])

  const problem = () => {
    if (form.name.trim().length < 2) return 'Please enter your full name.'
    if (!inviteToken && form.orgName.trim().length < 2) return "Please enter your organisation's name."
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.email.trim())) return 'Please enter a valid email address.'
    if (form.password.length < MIN_PASSWORD) return `Your password must be at least ${MIN_PASSWORD} characters. A short sentence works well.`
    if (form.password !== form.confirm) return 'The two passwords do not match.'
    return ''
  }

  const fail = (error, fallback) => toaster.create({
    title: fallback, type: 'error', closable: true,
    description: error?.status || error?.code === 'TIMEOUT' ? error.message : 'The server could not be reached. Please try again.',
  })

  const submitDetails = async (e) => {
    e.preventDefault()
    const p = problem()
    if (p) { toaster.create({ title: 'Check your details', description: p, type: 'warning', closable: true }); return }
    setBusy(true)
    try {
      const result = await api.signup({ name: form.name.trim(), orgName: inviteToken ? undefined : form.orgName.trim(), email: form.email.trim(), password: form.password, website: form.website, inviteToken: inviteToken || undefined })
      if (result.status === 'signed_in') { // test mode: no code needed, the server has already signed us in
        toaster.create({ title: 'Welcome to RoleMatch', description: inviteToken ? `Your account is ready, ${result.user?.name ?? ''}.` : `Your organisation "${form.orgName.trim()}" is ready, ${result.user?.name ?? ''}.`, type: 'success', closable: true })
        try { sessionStorage.setItem('th_just_signed_up', '1') } catch { /* optional */ }
        navigate('/overview')   // an invited sign-up has already joined the portal (the server redeems the invitation with the account)
        return
      }
      setStep('code'); setCooldown(60); setCode('')
    } catch (error) {
      if (error?.code === 'TIMEOUT') { setStep('code'); setCooldown(60); setCode('') }   // a code may already be on its way: wait, check, and only then ask again
      fail(error, error?.code === 'TIMEOUT' ? 'Still working' : 'Could not start sign-up')
    }
    setBusy(false)
  }

  const submitCode = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const { user } = await api.verifySignup(form.email.trim(), code.trim())
      toaster.create({ title: 'Welcome to RoleMatch', description: inviteToken ? `Your account is ready, ${user.name}.` : `Your organisation "${form.orgName.trim()}" is ready, ${user.name}.`, type: 'success', closable: true })
      try { sessionStorage.setItem('th_just_signed_up', '1') } catch { /* optional */ }
      navigate('/overview')   // an invited sign-up has already joined the portal (the server redeems the invitation with the account)
    } catch (error) { fail(error, 'Could not verify the code') }
    setBusy(false)
  }

  const [resending, setResending] = useState(false)
  const resend = async () => {
    if (resending || cooldown > 0) return   // one request at a time, and never inside the wait: no resend storm
    setResending(true)
    try { await api.resendSignup(form.email.trim()); setCooldown(60); toaster.create({ title: 'New code requested', description: 'The old code no longer works. It usually arrives within a minute; check your spam folder.', type: 'info', closable: true }) }
    catch (error) { if (error?.code === 'TIMEOUT') setCooldown(60); fail(error, error?.code === 'TIMEOUT' ? 'Still working' : 'Could not resend the code') }   // after a timeout the code may already be on its way
    setResending(false)
  }


  return (
    <Box minH="100vh" bg={bgColor} display="flex" flexDirection="column" alignItems="center" justifyContent="center" position="relative" overflow="hidden" py={10}>
      <Box position="absolute" top="50%" left="50%" transform="translate(-50%, -50%)" w="700px" h="700px" bg={glowColor} opacity={0.35} filter="blur(160px)" zIndex={0} borderRadius="full" />
      <Box maxW="md" w="full" p={8} bg={cardBg} borderRadius="xl" boxShadow="xl" position="relative" zIndex={1} mx={4} textAlign="center">
        <Box position="absolute" top="0" left="0" right="0" height="4px" bgImage="linear-gradient(to right, {colors.blue.400}, {colors.teal.400})" borderTopRadius="xl" />
        <VStack gap={5} align="center">
          <Heading size="lg" color={textColor}>{step === 'details' ? 'Create your account' : 'Check your email'}</Heading>
          <Box asChild display="inline-block"><Link to="/"><Image src={logo} alt="RoleMatch" height="36px" mx="auto" opacity="0.9" /></Link></Box>

          {step === 'details' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}>
              <VStack as="form" onSubmit={submitDetails} w="full" align="stretch" gap={4} noValidate>
                <Field.Root required><Field.Label fontSize="sm">Your full name<Field.RequiredIndicator /></Field.Label>
                  <Input {...inputStyle} value={form.name} onChange={set('name')} autoComplete="name" placeholder="Jordan Example" /></Field.Root>
                {!inviteToken && <Field.Root required><Field.Label fontSize="sm">Organisation<Field.RequiredIndicator /></Field.Label>
                  <Input {...inputStyle} value={form.orgName} onChange={set('orgName')} autoComplete="organization" placeholder="Your company or recruitment agency" /></Field.Root>}
                {inviteToken && invitation === false && <Text fontSize="sm" color="red.500">This invitation is not valid. Ask the person who invited you for a new one.</Text>}
                {inviteToken && invitation && <Text fontSize="sm" textAlign="left">You are joining <b>{invitation.portalName}</b> at <b>{invitation.orgName}</b>. Your account must use the invited address.</Text>}
                <Field.Root required><Field.Label fontSize="sm">Work email<Field.RequiredIndicator /></Field.Label>
                  <Input {...inputStyle} type="email" value={form.email} onChange={set('email')} readOnly={!!inviteToken} autoComplete="email" placeholder="you@company.com" /></Field.Root>
                <Field.Root required><Field.Label fontSize="sm">Password<Field.RequiredIndicator /></Field.Label>
                  <InputGroup endElement={<IconButton size="sm" variant="ghost" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((s) => !s)}>{showPassword ? <ViewOffIcon /> : <ViewIcon />}</IconButton>}>
                    <Input {...inputStyle} type={showPassword ? 'text' : 'password'} value={form.password} onChange={set('password')} autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD} characters`} />
                  </InputGroup>
                  <Field.HelperText fontSize="xs" textAlign="left">Longer is stronger: a short sentence is easy to remember and hard to guess.</Field.HelperText></Field.Root>
                <Field.Root required><Field.Label fontSize="sm">Confirm password<Field.RequiredIndicator /></Field.Label>
                  <Input {...inputStyle} type={showPassword ? 'text' : 'password'} value={form.confirm} onChange={set('confirm')} autoComplete="new-password" aria-invalid={form.confirm.length > 0 && form.confirm !== form.password ? true : undefined} /></Field.Root>
                {/* Honeypot: invisible to people, tempting to bots */}
                <Box position="absolute" left="-9999px" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label></Box>
                <Button tone="#007BA7" type="submit" loading={busy} loadingText="Sending code">Continue</Button>
                <Text fontSize="sm" color={mutedColor}>Already have an account? <Box asChild color="#007BA7" fontWeight="semibold"><Link to="/login">Log in</Link></Box></Text>
              </VStack>
            </motion.div>
          )}

          {step === 'code' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2, ease: [0, 0, 0.2, 1] }}>
              <VStack as="form" onSubmit={submitCode} w="full" align="stretch" gap={4}>
                <Box py={3} px={4} bg={noticeBg} borderRadius="md" borderLeft="3px solid" borderColor="blue.400" textAlign="left">
                  <Text fontSize="sm" color={noticeText}>We asked our mail system to send a verification code to <strong>{form.email}</strong>. It usually arrives within a minute; check your spam folder if it does not. It is valid for 15 minutes. You can ask for a new one once a minute, and the old code stops working. Please wait for the countdown before asking again.</Text>
                </Box>
                <Field.Root required><Field.Label fontSize="sm" textAlign="center">Verification code<Field.RequiredIndicator /></Field.Label>
                  <Input {...inputStyle} ref={codeRef} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 10))} inputMode="numeric" autoComplete="one-time-code" textAlign="center" fontWeight="bold" fontSize="xl" letterSpacing="0.3em" placeholder="••••••" aria-label="Verification code" /></Field.Root>
                <Button tone="#007BA7" type="submit" loading={busy} loadingText="Checking" disabled={code.length < 6}>Verify and create account</Button>
                <Button variant="ghost" size="sm" onClick={resend} disabled={cooldown > 0 || resending} loading={resending}>{cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}</Button>
                <Button variant="link" size="sm" onClick={() => setStep('details')}>Use a different email address</Button>
              </VStack>
            </motion.div>
          )}
        </VStack>
      </Box>
      <IconButton aria-label="Toggle colour mode" onClick={toggleColorMode} position="absolute" top={4} left={4} variant="ghost">{colorMode === 'light' ? <MoonIcon /> : <SunIcon />}</IconButton>
      <Text position="absolute" bottom="4" fontSize="xs" color={mutedColor}>© {new Date().getFullYear()} RoleMatch. All rights reserved.</Text>
    </Box>
  )
}
