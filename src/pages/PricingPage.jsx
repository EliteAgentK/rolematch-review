import React, { useState, useRef } from 'react';
import {
  Box,
  Container,
  Flex,
  Heading,
  HStack,
  Icon,
  List,
  SimpleGrid,
  Stack,
  Text,
  VStack,
  Badge,
  Separator,
  Grid,
  GridItem,
  useDisclosure,
  Dialog,
  Portal,
  Accordion,
} from '@chakra-ui/react';
import { motion, useInView } from 'motion/react';
import { useColorModeValue } from '../theme/color-mode';
import { Button } from '../components/ui/button';
import { DialogCloseButton, DialogHeader } from '../components/ui/dialog';
import { ChevronDownIcon } from '../components/ui/icons';
import { Switch } from '../components/ui/switch';
import { 
  FiCheck, 
  FiX, 
  FiStar, 
  FiUsers, 
  FiBarChart2, 
  FiAward, 
  FiFileText, 
  FiGlobe, 
  FiLock, 
  FiServer,
  FiHelpCircle,
  FiAlertCircle,
  FiZap,
  FiCheckCircle
} from 'react-icons/fi';
import Navbar from '../components/Navbar';

// Motion components
const MotionBox = motion.create(Box);
const MotionFlex = motion.create(Flex);

const PricingPage = () => {
  // State for monthly/annual billing toggle
  const [isAnnual, setIsAnnual] = useState(true);
  
  // Refs for scroll animations
  const pricingRef = useRef(null);
  const isPricingInView = useInView(pricingRef, { once: false, amount: 0.2 });
  
  // Enterprise plan modal
  const { open: isOpen, onOpen, onClose } = useDisclosure();
  
  // Color scheme
  const bgColor = useColorModeValue('gray.50', 'gray.900');
  const cardBg = useColorModeValue('white', 'gray.800');
  const borderColor = useColorModeValue('gray.200', 'gray.700');
  const textColor = useColorModeValue('gray.800', 'white');
  const textMuted = useColorModeValue('gray.600', 'gray.400');
  const accentBlue = useColorModeValue('#007BA7', '#60CCD9');
  const accentPurple = useColorModeValue('#5D3FD3', '#7B68EE');
  const accentGreen = useColorModeValue('#3EB489', '#6FCF97');
  const primaryBg = useColorModeValue('blue.50', 'blue.900');
  
  // Pricing tiers configuration
  const tiers = [
    {
      name: 'Starter',
      price: isAnnual ? 879 : 1099,
      description: 'For startups and lean teams who want fast, smart matching.',
      color: 'gray.500',
      features: [
        { text: 'Up to 100 document parses', included: true },
        { text: 'Basic AI candidate matching', included: true },
        { text: 'Skills gap summary & match score', included: true },
        { text: 'Lightweight analytics dashboard', included: true },
        { text: 'Downloadable match reports', included: true },
        { text: 'Email support', included: true }
      ]
    },
    {
      name: 'Professional',
      price: isAnnual ? 1759 : 2199,
      description: 'For teams who want faster shortlisting and deeper candidate insights.',
      color: accentBlue,
      features: [
        { text: 'Up to 500 document parses', included: true },
        { text: 'Advanced AI matching (1:1 and 1:Many)', included: true },
        { text: 'Automated non-technical assessments', included: true },
        { text: 'Match scoring breakdowns', included: true },
        { text: 'Smart candidate shortlists', included: true },
        { text: 'Team collaboration (up to 5 users)', included: true },
        { text: 'Skills & performance dashboards', included: true },
        { text: 'API integration', included: true },
        { text: 'Priority support', included: true }
      ],
      isPopular: true
    },
    {
      name: 'Business',
      price: isAnnual ? 4399 : 5499,
      description: 'For organizations and agencies processing hundreds or thousands of candidates monthly.',
      color: accentPurple,
      features: [
        { text: 'Unlimited document parsing & matching', included: true },
        { text: 'High-speed bulk matching engine', included: true },
        { text: 'Text-based 1st interview workflows', included: true },
        { text: 'Internal mobility matching', included: true },
        { text: 'Career path & upskilling insights', included: true },
        { text: 'Advanced analytics: hiring sources, match trends, pipeline health', included: true },
        { text: 'Custom dashboards & white-labeled portals', included: true },
        { text: 'Unlimited users & team roles', included: true },
        { text: 'Dedicated success manager', included: true },
        { text: 'SLA-based priority support', included: true }
      ]
    }
  ];
  
  // Feature comparison for detailed comparison section
  const featureCategories = [
    {
      name: 'Document Processing',
      features: [
        { name: 'Document Parsing Capacity', starter: '100 documents', pro: '500 documents', business: 'Unlimited' },
        { name: 'CV/Resume Parsing', starter: 'Basic', pro: 'Advanced', business: 'Advanced' },
        { name: 'Job Description Parsing', starter: 'Basic', pro: 'Advanced', business: 'Advanced' },
        { name: 'Bulk Processing', starter: false, pro: 'Limited', business: 'High-speed engine' },
        { name: 'Document Types Supported', starter: 'Basic formats', pro: 'Extended formats', business: 'All formats' }
      ]
    },
    {
      name: 'AI Matching & Assessment',
      features: [
        { name: 'AI Matching Type', starter: 'Basic 1:1', pro: '1:1 and 1:Many', business: 'All types + Bulk' },
        { name: 'Match Score Breakdown', starter: 'Summary only', pro: 'Detailed', business: 'Comprehensive' },
        { name: 'Skills Gap Analysis', starter: 'Basic summary', pro: 'Detailed', business: 'Advanced' },
        { name: 'Non-technical Assessments', starter: false, pro: true, business: true },
        { name: 'Internal Mobility Matching', starter: false, pro: false, business: true },
        { name: '1st Interview Workflows', starter: false, pro: false, business: true }
      ]
    },
    {
      name: 'Analytics & Reporting',
      features: [
        { name: 'Analytics Dashboard', starter: 'Lightweight', pro: 'Full featured', business: 'Custom + White label' },
        { name: 'Match Reports', starter: 'Downloadable', pro: 'Interactive', business: 'Custom formats' },
        { name: 'Skills & Performance Tracking', starter: false, pro: true, business: true },
        { name: 'Hiring Source Analytics', starter: false, pro: false, business: true },
        { name: 'Pipeline Health Metrics', starter: false, pro: 'Basic', business: 'Advanced' },
        { name: 'Career Path Insights', starter: false, pro: false, business: true }
      ]
    },
    {
      name: 'Collaboration & Support',
      features: [
        { name: 'User Accounts', starter: '1 user', pro: 'Up to 5 users', business: 'Unlimited' },
        { name: 'Team Collaboration', starter: false, pro: true, business: true },
        { name: 'API Integration', starter: false, pro: true, business: true },
        { name: 'Support Level', starter: 'Email', pro: 'Priority', business: 'SLA-based' },
        { name: 'Dedicated Success Manager', starter: false, pro: false, business: true }
      ]
    }
  ];
  
  // FAQ data
  const faqs = [
    {
      question: 'How does the billing cycle work?',
      answer: 'You can choose between monthly or annual billing. Annual billing includes a 20% discount compared to monthly billing. Your subscription will automatically renew at the end of each billing cycle unless canceled.'
    },
    {
      question: 'Can I upgrade or downgrade my plan?',
      answer: 'Yes, you can upgrade your plan at any time and the new features will be available immediately. When downgrading, the changes will take effect at the end of your current billing cycle.'
    },
    {
      question: 'Is there a free trial available?',
      answer: 'Yes, we offer a 14-day free trial on all plans. You can try out all the features without commitment. No credit card is required to start a trial.'
    },
    {
      question: 'How do candidate profile limits work?',
      answer: 'Candidate profiles are unique candidates in your talent pool. Once you reach your limit, you\'ll need to upgrade your plan or archive inactive profiles to make space for new ones.'
    },
    {
      question: 'What kind of support is included?',
      answer: 'All plans include access to our help center and documentation. The Professional plan adds live chat support during business hours. Business plans include priority support with faster response times and a dedicated account manager.'
    },
    {
      question: 'What are the custom integration options?',
      answer: 'Business plans include integration with popular ATS systems, HRIS, and job boards. Our team can also develop custom integrations with your existing HR tech stack.'
    }
  ];
  
  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1
      }
    }
  };
  
  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.5
      }
    }
  };
  
  return (
    <Box>
      <Navbar />
      
      {/* Hero Section */}
      <Box 
        pt="120px" 
        pb={20}
        bgImage={useColorModeValue(
          'linear-gradient(to bottom, white, {colors.blue.50})',
          'linear-gradient(to bottom, {colors.gray.900}, {colors.blue.900})'
        )}
      >
        <Container maxW="container.xl" textAlign="center">
          <VStack gap={6}>
            <Badge
              colorPalette="blue"
              fontSize="sm"
              px={3}
              py={1}
              borderRadius="full"
            >
              Pricing Plans
            </Badge>
            
            <Heading
              as="h1"
              fontSize={{ base: '3xl', md: '4xl', lg: '5xl' }}
              fontWeight="bold"
              mb={4}
            >
              Simple, Transparent{' '}
              <Box
                as="span"
                bgImage="linear-gradient(to right, {colors.blue.400}, {colors.purple.500})"
                bgClip="text"
              >
                Pricing
              </Box>
            </Heading>
            
            <Text
              fontSize={{ base: 'lg', md: 'xl' }}
              maxW="3xl"
              mx="auto"
              color={textMuted}
            >
              Choose the plan that fits your recruiting needs. All plans include our core AI-powered matching technology.
            </Text>
            
            {/* Billing Toggle */}
            <Flex
              alignItems="center"
              justifyContent="center"
              mt={8}
              mb={10}
            >
              <Text
                fontWeight={!isAnnual ? 'bold' : 'normal'}
                color={!isAnnual ? textColor : textMuted}
              >
                Monthly
              </Text>
              <Switch
                mx={4}
                colorPalette="blue"
                size="lg"
                checked={isAnnual}
                onCheckedChange={() => setIsAnnual(!isAnnual)}
              />
              <Flex alignItems="center">
                <Text
                  fontWeight={isAnnual ? 'bold' : 'normal'}
                  color={isAnnual ? textColor : textMuted}
                  mr={2}
                >
                  Annual
                </Text>
                <Badge colorPalette="green" borderRadius="full" px={2}>
                  Save 20%
                </Badge>
              </Flex>
            </Flex>
          </VStack>
        </Container>
      </Box>
      
      {/* Pricing Cards */}
      <Box bg={bgColor} py={{ base: 14, md: 20 }} ref={pricingRef}>
        <Container maxW="container.xl">
          {/* Chakra 2 drew this as a flex row (its Flex display won over SimpleGrid's grid); kept so */}
          <MotionFlex
            gap={{ base: 10, lg: 8 }}
            direction={{ base: "column", lg: "row" }}   // a column on phones and tablets: side by side the cards ran off a phone's screen (browser tests, 9 Nov 2026)
            mx="auto"
            variants={containerVariants}
            initial="hidden"
            animate={isPricingInView ? "visible" : "hidden"}
          >
            {tiers.map((tier, index) => (
              <MotionBox
                key={tier.name}
                variants={itemVariants}
                height="100%"
                zIndex={tier.isPopular ? 1 : 0}
                transform={tier.isPopular ? { lg: 'scale(1.05)' } : {}}
              >
                <Flex
                  direction="column"
                  borderWidth="1px"
                  borderColor={tier.isPopular ? tier.color : borderColor}
                  borderRadius="xl"
                  bg={cardBg}
                  boxShadow={tier.isPopular ? 'lg' : 'base'}
                  overflow="hidden"
                  height="100%"
                  position="relative"
                >
                  {tier.isPopular && (
                    <Badge
                      bgColor="orange.500"
                      color="white"
                      position="absolute"
                      top={4}
                      right={4}
                      borderRadius="full"
                      px={3}
                      py={1}
                      fontWeight="bold"
                    >
                      Most Popular
                    </Badge>
                  )}
                  
                  {/* Tier header */}
                  <Box
                    py={6}
                    px={8}
                    bg={tier.isPopular ? primaryBg : 'transparent'}
                    borderBottomWidth="1px"
                    borderColor={borderColor}
                  >
                    <Text
                      fontWeight="bold"
                      fontSize="xl"
                      color={tier.color}
                      mb={1}
                    >
                      {tier.name}
                    </Text>
                    <Text fontSize="sm" color={textMuted} mb={6}>
                      {tier.description}
                    </Text>
                    
                    <Flex align="flex-end" mb={2}>
                      <Text fontSize="4xl" fontWeight="bold" lineHeight="1.2">
                        R{tier.price}
                      </Text>
                      <Text fontSize="md" ml={2} mb={1} color={textMuted}>
                        /{isAnnual ? 'month' : 'month'}
                      </Text>
                    </Flex>
                    <Text fontSize="sm" color={textMuted}>
                      {isAnnual ? 'billed annually' : 'billed monthly'}
                    </Text>
                  </Box>
                  
                  {/* Features list */}
                  <VStack py={8} px={8} gap={4} flex="1">
                    {tier.features.map((feature, idx) => (
                      <HStack key={idx} w="full" alignItems="center" gap={4}>
                        <Box color={feature.included ? 'green.400' : 'red.400'}>
                          <Icon
                            as={feature.included ? FiCheck : FiX}
                            boxSize={5}
                          />
                        </Box>
                        <Text
                          color={feature.included ? textColor : textMuted}
                          fontSize="sm"
                        >
                          {feature.text}
                        </Text>
                      </HStack>
                    ))}
                  </VStack>
                  
                  {/* CTA */}
                  <Box py={6} px={8} borderTopWidth="1px" borderColor={borderColor}>
                    <Button
                      colorPalette={tier.isPopular ? 'blue' : 'gray'}
                      variant={tier.isPopular ? 'solid' : 'outline'}
                      w="full"
                      size="lg"
                      fontWeight="bold"
                      py={6}
                    >
                      {tier.name === 'Business' ? 'Contact Sales' : 'Get Started'}
                    </Button>
                  </Box>
                </Flex>
              </MotionBox>
            ))}
          </MotionFlex>
        </Container>
      </Box>
      
      {/* Enterprise Section */}
      <Box bg={useColorModeValue('blue.50', 'gray.800')} py={16}>
        <Container maxW="container.lg">
          <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={10} alignItems="center">
            <GridItem>
              <Heading as="h2" size="xl" mb={4}>
                Enterprise Solutions
              </Heading>
              <Text fontSize="lg" color={textMuted} mb={6}>
                For larger organizations with complex hiring needs and custom requirements.
              </Text>
              
              <List.Root mb={8} css={{ "& > *:not(style) ~ *:not(style)": { mt: 4 } }}>
                {[
                  'Custom implementation and onboarding',
                  'Dedicated account management team',
                  'Custom AI model training for your industry',
                  'Advanced security and compliance features',
                  'API access and custom integration development',
                  'Bulk import/export of candidate data'
                ].map((feature, idx) => (
                  <List.Item key={idx} display="flex">
                    <List.Indicator asChild role="presentation" color={accentGreen} mt={1}><FiCheckCircle /></List.Indicator>
                    <Text>{feature}</Text>
                  </List.Item>
                ))}
              </List.Root>
              
              <Button
                size="lg"
                colorPalette="purple"
                onClick={onOpen}
                rightIcon={<FiUsers />}
              >
                Request Custom Quote
              </Button>
            </GridItem>
            
            <GridItem>
              <Box
                bg={cardBg}
                borderRadius="xl"
                p={8}
                borderWidth="1px"
                borderColor={borderColor}
                boxShadow="xl"
              >
                <VStack align="start" gap={6}>
                  <Flex
                    bg={useColorModeValue('purple.100', 'purple.900')}
                    color={accentPurple}
                    p={3}
                    borderRadius="lg"
                  >
                    <Icon as={FiStar} boxSize={6} />
                  </Flex>
                  
                  <Heading as="h3" size="md">
                    Why Choose Enterprise?
                  </Heading>
                  
                  <Box>
                    <HStack mb={3}>
                      <Icon as={FiZap} color={accentPurple} />
                      <Text fontWeight="bold">Scale with confidence</Text>
                    </HStack>
                    <Text color={textMuted} fontSize="sm">
                      Handle thousands of jobs and candidates with a solution that grows with your organization.
                    </Text>
                  </Box>
                  
                  <Box>
                    <HStack mb={3}>
                      <Icon as={FiLock} color={accentPurple} />
                      <Text fontWeight="bold">Enhanced security</Text>
                    </HStack>
                    <Text color={textMuted} fontSize="sm">
                      Advanced data protection, SSO, and compliance features for enterprise-grade security.
                    </Text>
                  </Box>
                  
                  <Box>
                    <HStack mb={3}>
                      <Icon as={FiServer} color={accentPurple} />
                      <Text fontWeight="bold">Custom integrations</Text>
                    </HStack>
                    <Text color={textMuted} fontSize="sm">
                      Seamlessly connect RoleMatch with your existing HR systems and workflows.
                    </Text>
                  </Box>
                  
                  <Separator />
                  
                  <HStack
                    bg={useColorModeValue('gray.100', 'gray.700')}
                    p={4}
                    borderRadius="md"
                    w="full"
                  >
                    <Icon as={FiAlertCircle} color={accentBlue} />
                    <Text fontSize="sm">
                      Typical implementation time: 2-4 weeks
                    </Text>
                  </HStack>
                </VStack>
              </Box>
            </GridItem>
          </Grid>
        </Container>
      </Box>
      
      {/* Feature Comparison */}
      <Box py={20} bg={bgColor}>
        <Container maxW="container.xl">
          <VStack gap={12}>
            <VStack gap={4} textAlign="center">
              <Heading as="h2" size="xl">
                Feature Comparison
              </Heading>
              <Text fontSize="lg" color={textMuted} maxW="3xl">
                A detailed breakdown of what's included in each plan to help you choose the best option.
              </Text>
            </VStack>
            
            {featureCategories.map((category) => (
              <Box key={category.name} width="full">
                <Heading as="h3" size="md" mb={6} pb={2} borderBottomWidth="1px" borderColor={borderColor}>
                  {category.name}
                </Heading>
                
                <Table>
                  <TableHead />
                  <TableBody>
                    {category.features.map((feature, idx) => (
                      <TableRow key={idx}>
                        <TableCell fontWeight="medium">{feature.name}</TableCell>
                        <TableCell>
                          <FeatureValue value={feature.starter} />
                        </TableCell>
                        <TableCell>
                          <FeatureValue value={feature.pro} />
                        </TableCell>
                        <TableCell>
                          <FeatureValue value={feature.business} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            ))}
          </VStack>
        </Container>
      </Box>
      
      {/* FAQs Section */}
      <Box py={20} bg={useColorModeValue('white', 'gray.900')}>
        <Container maxW="container.lg">
          <VStack gap={10}>
            <VStack gap={4} textAlign="center">
              <Heading as="h2" size="xl">
                Frequently Asked Questions
              </Heading>
              <Text fontSize="lg" color={textMuted} maxW="2xl">
                Get answers to common questions about our pricing plans and features.
              </Text>
            </VStack>
            
            <Accordion.Root collapsible width="100%">
              {faqs.map((faq, idx) => (
                <Accordion.Item key={idx} value={String(idx)} border="none" mb={4}>
                  <h3>
                    <Accordion.ItemTrigger 
                      p={5} 
                      bg={cardBg} 
                      borderRadius="md"
                      _hover={{ bg: useColorModeValue('gray.100', 'gray.700') }}
                    >
                      <Box flex="1" textAlign="left" fontWeight="medium">
                        <HStack>
                          <Icon as={FiHelpCircle} color={accentBlue} mr={2} />
                          <Text>{faq.question}</Text>
                        </HStack>
                      </Box>
                      <Accordion.ItemIndicator asChild><ChevronDownIcon /></Accordion.ItemIndicator>
                    </Accordion.ItemTrigger>
                  </h3>
                  <Accordion.ItemContent><Accordion.ItemBody 
                    pb={4} 
                    pt={4} 
                    px={5} 
                    bg={useColorModeValue('gray.50', 'gray.800')}
                    borderBottomRadius="md"
                  >
                    {faq.answer}
                  </Accordion.ItemBody></Accordion.ItemContent>
                </Accordion.Item>
              ))}
            </Accordion.Root>
          </VStack>
        </Container>
      </Box>
      
      {/* CTA Section */}
      <Box py={20} bg={useColorModeValue('blue.50', 'blue.900')}>
        <Container maxW="container.md" textAlign="center">
          <VStack gap={8}>
            <Heading
              as="h2"
              size="xl"
              bgImage="linear-gradient(to right, {colors.blue.400}, {colors.purple.500})"
              bgClip="text"
            >
              Ready to transform your hiring process?
            </Heading>
            
            <Text fontSize="lg" maxW="2xl">
              Join hundreds of companies already using RoleMatch to find the right talent faster and more efficiently.
            </Text>
            
            <HStack gap={4} pt={4}>
              <Button
                size="lg"
                colorPalette="blue"
              >
                Start Free Trial
              </Button>
              
              <Button
                size="lg"
                variant="outline"
                borderWidth="2px"
              >
                Book a Demo
              </Button>
            </HStack>
            
            <Text fontSize="sm" color={textMuted}>
              No credit card required. 14-day free trial.
            </Text>
          </VStack>
        </Container>
      </Box>
      
      {/* Enterprise Modal */}
      <Dialog.Root open={isOpen} onOpenChange={(e) => { if (!e.open) onClose(); }} size="xl">
        <Portal>
        <Dialog.Backdrop backdropFilter="blur(5px)" />
        <Dialog.Positioner>
        <Dialog.Content borderRadius="xl" mx={4}>
          <DialogHeader
            borderBottomWidth="1px"
            borderColor={borderColor}
            pb={4}
          >
            Request Enterprise Information
          </DialogHeader>
          <DialogCloseButton />
          <Dialog.Body p={6}>
            <Text mb={6}>
              Please contact our sales team for a custom enterprise quote and implementation plan. Our team will get back to you within 24 hours.
            </Text>
            
            <VStack gap={4} align="stretch">
              <Text fontWeight="bold">
                Email: enterprise@rolematch.co.za
              </Text>
              <Text fontWeight="bold">
                Phone: (555) 123-4567
              </Text>
            </VStack>
          </Dialog.Body>
        </Dialog.Content>
        </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
      
    </Box>
  );
};

// Table components
const Table = ({ children }) => (
  <Box overflowX="auto">
    <Box minW="800px">
      {children}
    </Box>
  </Box>
);

const TableHead = () => {
  const bg = useColorModeValue('gray.50', 'gray.800');
  return (
    <Grid
      templateColumns="1.5fr 1fr 1fr 1fr"
      borderBottomWidth="1px"
      borderColor={useColorModeValue('gray.200', 'gray.700')}
      py={4}
      bg={bg}
      borderRadius="md"
      mb={2}
    >
      <GridItem px={4} fontWeight="bold">Feature</GridItem>
      <GridItem px={4} fontWeight="bold">Starter</GridItem>
      <GridItem px={4} fontWeight="bold">Professional</GridItem>
      <GridItem px={4} fontWeight="bold">Business</GridItem>
    </Grid>
  );
};

const TableBody = ({ children }) => (
  <Box>{children}</Box>
);

const TableRow = ({ children }) => (
  <Grid
    templateColumns="1.5fr 1fr 1fr 1fr"
    py={3}
    borderBottomWidth="1px"
    borderColor={useColorModeValue('gray.100', 'gray.800')}
    _hover={{ bg: useColorModeValue('gray.50', 'gray.900') }}
  >
    {children}
  </Grid>
);

const TableCell = ({ children, fontWeight = "normal" }) => (
  <GridItem px={4} fontWeight={fontWeight}>
    {children}
  </GridItem>
);

const FeatureValue = ({ value }) => {
  if (typeof value === 'boolean') {
    return value ? (
      <Icon as={FiCheck} color="green.500" boxSize={5} />
    ) : (
      <Icon as={FiX} color="red.500" boxSize={5} />
    );
  }
  
  return <Text>{value}</Text>;
};

export default PricingPage;
