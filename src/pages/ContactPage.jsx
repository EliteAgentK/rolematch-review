import React from 'react';
import {
  Box,
  Container,
  Heading,
  Text,
  VStack,
  HStack,
  Stack,
  Flex,
  Icon,
  SimpleGrid,
  Separator,
  Badge
} from '@chakra-ui/react';
import { motion } from 'motion/react';
import { useColorModeValue } from '../theme/color-mode';
import { Button } from '../components/ui/button';
import Animation from '@/components/Animation'
import {
  FiMail,
  FiMapPin,
  FiPhone,
  FiMessageCircle,
  FiSend,
  FiArrowRight
} from 'react-icons/fi';
import Navbar from '../components/Navbar';

// Framer Motion wrapper for Chakra components
const MotionBox = motion.create(Box);
const MotionFlex = motion.create(Flex);

const ContactPage = () => {
  // Colors
  const bgColor = useColorModeValue('gray.50', 'gray.900');
  const accentBlue = useColorModeValue('#007BA7', '#60CCD9');
  const accentPurple = useColorModeValue('#5D3FD3', '#7B68EE');
  const cardBg = useColorModeValue('white', 'gray.800');
  const cardBorder = useColorModeValue('gray.200', 'gray.700');
  const textColor = useColorModeValue('gray.700', 'gray.200');
  const subtitleColor = useColorModeValue('gray.600', 'gray.400');
  const highlightColor = useColorModeValue('blue.50', 'blue.900');
  
  // Variants for animations
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2
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

  // Contact methods
  const contactMethods = [
    {
      title: 'Email Us',
      icon: FiMail,
      value: 'hi@rolematch.co.za',
      description: 'Our friendly team is here to help',
      color: accentBlue
    },
    {
      title: 'Visit Us',
      icon: FiMapPin,
      value: 'Cape Town, South Africa',
      description: 'Come say hello at our office',
      color: accentPurple
    },
    {
      title: 'Call Us',
      icon: FiPhone,
      value: '+27 (0) 21 000 0000',
      description: 'Mon-Fri from 8am to 5pm',
      color: '#3EB489'
    }
  ];

  return (
    <Box bg={bgColor} minH="100vh">
      <Navbar />
      
      {/* Hero Section */}
      <Box
        pt="120px"
        pb="80px"
        bgImage={useColorModeValue(
          'linear-gradient(to bottom, white, {colors.blue.50})',
          'linear-gradient(to bottom, {colors.gray.900}, {colors.blue.900})'
        )}
      >
        <Container maxW="container.xl">
          <SimpleGrid columns={{ base: 1, lg: 2 }} gap={10} alignItems="center">
            {/* Left Column: Text */}
            <MotionBox
              initial={{ opacity: 0, x: -50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6 }}
            >
              <VStack gap={6} align="flex-start">
                <Badge 
                  colorPalette="blue" 
                  fontSize="sm" 
                  px={3} 
                  py={1} 
                  borderRadius="full"
                >
                  Get in Touch
                </Badge>
                <Heading 
                  as="h1" 
                  size="2xl" 
                  fontWeight="bold"
                  lineHeight="1.2"
                  mb={4}
                >
                  We'd love to hear from you
                </Heading>
                <Text fontSize="xl" color={subtitleColor} mb={6}>
                  Our team is ready to answer your questions about RoleMatch and help you find the perfect talent solution for your organization.
                </Text>
                
                {/* Side by side where there is room; one above the other on a phone, so the page never scrolls sideways (layout audit, 11 Nov 2026). */}
                <Stack direction={{ base: "column", sm: "row" }} gap={3} align={{ base: "stretch", sm: "center" }}>
                  <Button tone={accentBlue}
                    size="lg"
                    rightIcon={<Icon as={FiSend} />}
                    onClick={() => window.location.href = 'mailto:hi@rolematch.co.za'}
                  >
                    Email Us Now
                  </Button>
                  <Button tone={accentBlue}
                    size="lg"
                    variant="outline"
                    rightIcon={<Icon as={FiArrowRight} />}
                  >
                    Request a Demo
                  </Button>
                </Stack>
              </VStack>
            </MotionBox>
            
            {/* Right Column: Animation */}
            <MotionBox
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              display="flex"
              justifyContent="center"
            >
              <Box maxW="450px" w="100%">
                <Animation
                  autoplay
                  loop
                  src="/animations/centerpule.json"
                  style={{ width: '100%', height: '400px' }}
                />
              </Box>
            </MotionBox>
          </SimpleGrid>
        </Container>
      </Box>
      
      {/* Contact Information */}
      <Container maxW="container.xl" py={16}>
        <SimpleGrid columns={{ base: 1, md: 3 }} gap={10}>
          {contactMethods.map((method, index) => (
            <MotionFlex
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              bg={cardBg}
              p={8}
              borderRadius="xl"
              boxShadow="md"
              border="1px solid"
              borderColor={cardBorder}
              direction="column"
              align="center"
              textAlign="center"
            >
              <Flex
                w="70px"
                h="70px"
                bg={method.color}
                color="white"
                borderRadius="full"
                align="center"
                justify="center"
                mb={4}
              >
                <Icon as={method.icon} boxSize={8} />
              </Flex>
              <Heading size="md" mb={2}>
                {method.title}
              </Heading>
              <Text color={subtitleColor} mb={2}>
                {method.description}
              </Text>
              <Text fontWeight="bold" fontSize="lg">
                {method.value}
              </Text>
            </MotionFlex>
          ))}
        </SimpleGrid>
      </Container>
      
      {/* Main Contact Section */}
      <Box bg={useColorModeValue('white', 'gray.800')} py={16}>
        <Container maxW="container.xl">
          <SimpleGrid columns={{ base: 1, lg: 2 }} gap={10}>
            {/* Left: Animation & Email */}
            <MotionBox
              id="demo-request"
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              bg={highlightColor}
              p={8}
              borderRadius="xl"
              boxShadow="lg"
            >
              <VStack gap={6} align="flex-start">
                <Heading as="h2" size="xl">
                  Ready to transform your hiring process?
                </Heading>
                <Text fontSize="lg" color={subtitleColor}>
                  Email us at <Box as="span" fontWeight="bold" color={accentBlue}>hi@rolematch.co.za</Box> to:
                </Text>
                
                <VStack gap={4} align="flex-start" w="full">
                  {[
                    "Schedule a personalized demo",
                    "Discuss your specific recruitment challenges",
                    "Get a customized pricing quote",
                    "Learn about implementation and onboarding"
                  ].map((item, index) => (
                    <HStack key={index} gap={3}>
                      <Flex
                        w="30px"
                        h="30px"
                        bg={accentBlue}
                        color="white"
                        borderRadius="full"
                        align="center"
                        justify="center"
                        flexShrink={0}
                      >
                        <Text fontWeight="bold">{index + 1}</Text>
                      </Flex>
                      <Text>{item}</Text>
                    </HStack>
                  ))}
                </VStack>
                
                <Separator my={4} />
                
                <HStack gap={4}>
                  <Icon as={FiMessageCircle} boxSize={10} color={accentBlue} />
                  <VStack align="flex-start" gap={0}>
                    <Text fontWeight="bold" fontSize="xl">
                      Response Time
                    </Text>
                    <Text>
                      We typically respond within 2-4 business hours
                    </Text>
                  </VStack>
                </HStack>
                
                <Button tone={accentBlue}
                  size="lg"
                  rightIcon={<Icon as={FiSend} />}
                  onClick={() => window.location.href = 'mailto:hi@rolematch.co.za'}
                  w={{ base: 'full', md: 'auto' }}
                  mt={2}
                >
                  Email hi@rolematch.co.za
                </Button>
              </VStack>
            </MotionBox>
            
            {/* Right: Animation */}
            <MotionBox
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              display="flex"
              alignItems="center"
              justifyContent="center"
            >
              <Animation
                autoplay
                loop
                src="/animations/matching.json"
                style={{ width: '100%', height: '400px' }}
              />
            </MotionBox>
          </SimpleGrid>
        </Container>
      </Box>
      
      {/* FAQ Section */}
      <Box py={16} bg={bgColor}>
        <Container maxW="container.lg" textAlign="center">
          <VStack gap={8} mb={12}>
            <Heading as="h2" size="xl">
              Frequently Asked Questions
            </Heading>
            <Text fontSize="lg" color={subtitleColor} maxW="700px">
              Have questions about RoleMatch? Here are some answers to commonly asked questions.
            </Text>
          </VStack>
          
          <SimpleGrid columns={{ base: 1, md: 2 }} gap={8}>
            {[
              {
                question: "How quickly can we get started with RoleMatch?",
                answer: "Most customers are up and running within 1-2 days. Our team will guide you through the setup process and provide initial training to ensure a smooth start."
              },
              {
                question: "Can I import our existing candidate database?",
                answer: "Yes! We offer data migration services to seamlessly import your existing candidate profiles and job descriptions into the RoleMatch platform."
              },
              {
                question: "Do you offer custom enterprise solutions?",
                answer: "Absolutely. Our enterprise solutions can be tailored to your specific requirements, including custom integrations, dedicated support, and specialized features."
              },
              {
                question: "Is there a free trial available?",
                answer: "We offer a 14-day free trial of our Professional plan. Contact us at hi@rolematch.co.za to set up your trial account today."
              }
            ].map((faq, index) => (
              <MotionBox
                key={index}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                bg={cardBg}
                p={6}
                borderRadius="lg"
                boxShadow="md"
                border="1px solid"
                borderColor={cardBorder}
                textAlign="left"
              >
                <Heading as="h3" size="md" mb={3}>
                  {faq.question}
                </Heading>
                <Text color={subtitleColor}>
                  {faq.answer}
                </Text>
              </MotionBox>
            ))}
          </SimpleGrid>
          
          <Box mt={12}>
            <Text fontSize="lg" fontWeight="medium" mb={4}>
              Still have questions?
            </Text>
            <Button tone={accentBlue}
              size="lg"
              onClick={() => window.location.href = 'mailto:hi@rolematch.co.za'}
            >
              Contact Our Support Team
            </Button>
          </Box>
        </Container>
      </Box>
      
    </Box>
  );
};

export default ContactPage;
