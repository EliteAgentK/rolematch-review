import React, { useRef, useEffect, useState } from 'react';
import {
  Box,
  Container,
  Heading,
  Text,
  VStack,
  HStack,
  Stack,
  SimpleGrid,
  Grid,
  GridItem,
  Flex,
  Icon,
  Separator,
  Badge,
  List,
  useDisclosure,
  Dialog,
  Portal,
} from '@chakra-ui/react';
import { useColorModeValue } from '../theme/color-mode';
import { Button } from '../components/ui/button';
import { DialogCloseButton, DialogHeader } from '../components/ui/dialog';
import { Image } from '../components/ui/image';
import { keyframes } from '@emotion/react';
import { motion, useInView } from 'motion/react';
import Animation from '@/components/Animation'
import { 
  FiUpload, 
  FiUsers, 
  FiAward, 
  FiBarChart2, 
  FiCheckCircle, 
  FiSearch, 
  FiStar, 
  FiFileText, 
  FiTrendingUp, 
  FiDollarSign,
  FiArrowRight,
  FiCode,
  FiLock,
  FiSettings,
  FiGitBranch,
  FiZap,
  FiGlobe,
  FiThumbsUp,
  FiEdit
} from 'react-icons/fi';
import Navbar from '../components/Navbar';

// Framer Motion wrapper for Chakra components
const MotionBox = motion.create(Box);
const MotionSimpleGrid = motion.create(SimpleGrid);
const MotionFlex = motion.create(Flex);
const MotionGridItem = motion.create(GridItem);
const MotionContainer = motion.create(Container);

const FeaturesPage = () => {
  // Colors
  const bgColor = useColorModeValue('gray.50', 'gray.900');
  const textColor = useColorModeValue('gray.700', 'gray.200');
  const accentColor = useColorModeValue('blue.500', 'blue.300');
  const accentBlue = useColorModeValue('#007BA7', '#60CCD9');
  const accentPurple = useColorModeValue('#5D3FD3', '#7B68EE');
  const accentGreen = useColorModeValue('#3EB489', '#6FCF97');
  const accentOrange = useColorModeValue('#FF5E3A', '#FF8A65');
  const cardBg = useColorModeValue('white', 'gray.800');
  const cardBorder = useColorModeValue('gray.200', 'gray.700');
  const subtitleColor = useColorModeValue('gray.600', 'gray.400');
  const highlightColor = useColorModeValue('blue.50', 'blue.900');
  
  // Refs for scroll animations
  const heroRef = useRef(null);
  const isHeroInView = useInView(heroRef, { once: false, amount: 0.3 });
  
  // Demo video modal
  const { open: isOpen, onOpen, onClose } = useDisclosure();
  
  // Illustration animation effect
  const illustrationScale = keyframes`
    0% { transform: scale(1); }
    50% { transform: scale(1.05); }
    100% { transform: scale(1); }
  `;
  
  // Staggered appearance for feature items
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
  
  // Floating animation for badges
  const floatAnimation = keyframes`
    0% { transform: translateY(0px); }
    50% { transform: translateY(-10px); }
    100% { transform: translateY(0px); }
  `;
  
  // Feature data
  const mainFeatures = [
    {
      title: "AI-Powered Matching",
      description: "Our proprietary algorithm identifies the most compatible candidates based on skills, experience, and cultural fit.",
      icon: FiAward,
      color: accentBlue,
      animation: "/animations/matching.json"
    },
    {
      title: "Skills Analysis",
      description: "Detailed breakdown of candidate skills with gap analysis to identify perfect matches and development opportunities.",
      icon: FiBarChart2,
      color: accentPurple
    },
    {
      title: "Intelligent Shortlisting",
      description: "Create, share and collaborate on candidate shortlists that automatically update based on your criteria.",
      icon: FiStar,
      color: accentOrange
    },
    {
      title: "Document Processing",
      description: "Automatically extract key information from resumes, job descriptions, and other documents.",
      icon: FiFileText,
      color: accentGreen
    }
  ];
  
  const advancedFeatures = [
    {
      title: "Automated Assessments",
      description: "Non-technical assessments that evaluate soft skills, cultural fit and work preferences to find the perfect match.",
      icon: FiCheckCircle,
      color: accentGreen
    },
    {
      title: "Text-Based Interviews",
      description: "Streamlined 1st interview workflows that save time by automating initial candidate screening with customizable questions.",
      icon: FiFileText,
      color: accentOrange
    },
    {
      title: "CV & Job Description Refinement",
      description: "AI-assisted creation and optimization of job descriptions and CV refinement to attract the right candidates and improve matching.",
      icon: FiEdit,
      color: accentBlue
    },
    {
      title: "Talent Mobility",
      description: "Identify internal candidates for open positions and create career progression paths for your team.",
      icon: FiTrendingUp,
      color: accentPurple
    },
    {
      title: "Diversity & Inclusion",
      description: "Reduce bias in your hiring process with our AI that focuses on skills and capabilities, not background.",
      icon: FiUsers,
      color: accentBlue
    },
    {
      title: "Data-Driven Insights",
      description: "Comprehensive analytics dashboard with hiring metrics, skills gap analysis, and recruitment channel effectiveness.",
      icon: FiBarChart2,
      color: accentGreen
    },
    {
      title: "Integration Ecosystem",
      description: "Connect with your existing HR tools, ATS systems, and job boards for a seamless workflow.",
      icon: FiGitBranch,
      color: accentOrange
    }
  ];
  
  const benefitsList = [
    "Reduce time-to-hire by up to 60%",
    "Improve candidate quality and job fit",
    "Decrease recruitment costs by 40%",
    "Boost retention with better matched hires",
    "Eliminate unconscious bias from selection",
    "Create data-driven hiring strategies"
  ];
  
  return (
    <Box>
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
          <Grid
            templateColumns={{ base: "1fr", lg: "1fr 1fr" }}
            gap={10}
            alignItems="center"
          >
            <MotionBox
              ref={heroRef}
              initial={{ opacity: 0, x: -50 }}
              animate={isHeroInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -50 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            >
              <Badge
                colorPalette="blue"
                borderRadius="full"
                px={3}
                py={1}
                mb={4}
                fontWeight="medium"
              >
                RoleMatch Features
              </Badge>
              <Heading
                as="h1"
                fontSize={{ base: "3xl", md: "4xl", lg: "5xl" }}
                fontWeight="bold"
                lineHeight="shorter"
                mb={5}
              >
                Revolutionize Your{" "}
                <Box
                  as="span"
                  bgImage="linear-gradient(to right, {colors.blue.400}, {colors.purple.500})"
                  bgClip="text"
                >
                  Hiring Process
                </Box>
              </Heading>
              <Text
                fontSize={{ base: "md", md: "lg" }}
                color={subtitleColor}
                mb={8}
                maxW="90%"
              >
                Discover how RoleMatch's AI-powered matching and analytics can transform your talent acquisition strategy with our comprehensive feature set.
              </Text>
              <HStack gap={4} wrap="wrap">{/* the two buttons wrap on a phone instead of pushing the page wider than the screen */}
                <Button tone="blue.500"
                  size="lg"
                  onClick={onOpen}
                  leftIcon={<FiZap />}
                >
                  See Features in Action
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  rightIcon={<FiArrowRight />}
                >
                  Get a Demo
                </Button>
              </HStack>
              
              {/* Floating badges */}
              <HStack mt={10} gap={3} wrap="wrap">
                {["AI-Powered", "Skills Matching", "Bias Reduction", "Analytics", "Integrations"].map((badge, i) => (
                  <MotionBox
                    key={badge}
                    initial={{ opacity: 0, y: 20 }}
                    animate={isHeroInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                    transition={{ delay: 0.5 + (i * 0.1), duration: 0.5 }}
                  >
                    <Badge
                      animation={`${floatAnimation} ${3 + i * 0.5}s ease-in-out infinite`}
                      display="inline-block"
                      bg={highlightColor}
                      color={accentColor}
                      borderRadius="full"
                      px={3}
                      py={1}
                      boxShadow="sm"
                      fontSize="sm"
                    >
                      {badge}
                    </Badge>
                  </MotionBox>
                ))}
              </HStack>
            </MotionBox>
            
            <MotionBox
              initial={{ opacity: 0, scale: 0.8 }}
              animate={isHeroInView ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.8, delay: 0.3 }}
              position="relative"
            >
              <Box
                position="relative"
                borderRadius="2xl"
                overflow="hidden"
                boxShadow="2xl"
                height="400px"
                animation={`${illustrationScale} 8s ease-in-out infinite`}
              >
                <Image
                  src="/images/features-hero.png"
                  alt="RoleMatch features illustration"
                  fallbackSrc="/images/placeholder.svg"
                  width="100%"
                  height="100%"
                  objectFit="cover"
                />
                <Box
                  position="absolute"
                  top="0"
                  left="0"
                  width="100%"
                  height="100%"
                  bgImage={useColorModeValue(
                    'linear-gradient(to top right, rgba(0,123,167,0.1), rgba(93,63,211,0.1))',
                    'linear-gradient(to top right, rgba(0,123,167,0.3), rgba(93,63,211,0.3))'
                  )}
                />
                
                {/* Floating feature icons */}
                {[
                  { icon: FiAward, top: "15%", left: "15%", color: accentBlue, delay: 0 },
                  { icon: FiBarChart2, top: "20%", right: "15%", color: accentPurple, delay: 1.2 },
                  { icon: FiFileText, bottom: "20%", left: "20%", color: accentGreen, delay: 0.6 },
                  { icon: FiUsers, bottom: "15%", right: "20%", color: accentOrange, delay: 1.8 }
                ].map((item, index) => (
                  <MotionBox
                    key={index}
                    position="absolute"
                    top={item.top}
                    left={item.left}
                    right={item.right}
                    bottom={item.bottom}
                    initial={{ opacity: 0, y: 20 }}
                    animate={isHeroInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
                    transition={{ delay: 0.8 + item.delay, duration: 0.5 }}
                  >
                    <Flex
                      bg={cardBg}
                      color={item.color}
                      boxSize="50px"
                      borderRadius="full"
                      align="center"
                      justify="center"
                      boxShadow="lg"
                      animation={`${floatAnimation} ${3 + index * 0.5}s ease-in-out infinite`}
                    >
                      <Icon as={item.icon} boxSize={6} />
                    </Flex>
                  </MotionBox>
                ))}
              </Box>
            </MotionBox>
          </Grid>
        </Container>
      </Box>
      
      {/* Main Features Section */}
      <Box py="100px" bg={bgColor}>
        <Container maxW="container.xl">
          <VStack gap={20}>
            {/* Section intro */}
            <VStack gap={3} textAlign="center" maxW="container.md" mx="auto">
              <Heading
                fontSize={{ base: '3xl', md: '4xl' }}
                fontWeight="bold"
                bgImage="linear-gradient(to right, {colors.blue.400}, {colors.purple.500})"
                bgClip="text"
              >
                Core Features
              </Heading>
              <Text fontSize={{ base: "lg", md: "xl" }} color={subtitleColor} maxW="700px">
                RoleMatch streamlines your recruitment process with powerful features designed
                to match the right talent with the right opportunities.
              </Text>
            </VStack>
            
            {/* Feature Grid */}
            <MotionFlex
              as="ul"
              variants={containerVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: false, amount: 0.2 }}
              w="100%"
              direction="column"
              gap={12}
            >
              {mainFeatures.map((feature, index) => (
                <MotionFlex
                  as="li"
                  key={feature.title}
                  variants={itemVariants}
                  direction={{ base: "column", lg: index % 2 === 0 ? "row" : "row-reverse" }}
                  align="center"
                  gap={10}
                >
                  {/* Feature text */}
                  <Flex flex="1" direction="column" justify="center">
                    <Flex align="center" mb={4}>
                      <Flex
                        boxSize="50px"
                        bg={feature.color}
                        color="white"
                        borderRadius="xl"
                        align="center"
                        justify="center"
                        mr={4}
                      >
                        <Icon as={feature.icon} boxSize={6} />
                      </Flex>
                      <Heading as="h3" size="lg" fontWeight="bold">
                        {feature.title}
                      </Heading>
                    </Flex>
                    
                    <Text fontSize="lg" color={subtitleColor} mb={6}>
                      {feature.description}
                    </Text>
                    
                    <List.Root css={{ "& > *:not(style) ~ *:not(style)": { mt: 3 } }}>
                      {[1, 2, 3].map((item) => (
                        <List.Item key={item} display="flex" alignItems="center">
                          <List.Indicator asChild role="presentation" color={feature.color} marginRight={2}><FiCheckCircle /></List.Indicator>
                          <Text fontSize="md">
                            Feature benefit point #{item} related to {feature.title}
                          </Text>
                        </List.Item>
                      ))}
                    </List.Root>
                  </Flex>
                  
                  {/* Feature visualization */}
                  <Flex
                    flex="1"
                    justifyContent="center"
                    alignItems="center"
                    position="relative"
                  >
                    <Box
                      bg={cardBg}
                      borderRadius="xl"
                      boxShadow="xl"
                      borderWidth="1px"
                      borderColor={cardBorder}
                      overflow="hidden"
                      height="350px"
                      width="100%"
                      position="relative"
                    >
                      {feature.animation ? (
                        <Animation
                          autoplay
                          loop
                          src={feature.animation}
                          style={{ width: '100%', height: '100%' }}
                        />
                      ) : (
                        <Flex
                          height="100%"
                          width="100%"
                          justifyContent="center"
                          alignItems="center"
                          bgImage={`linear-gradient(to right, ${feature.color}20, ${feature.color}10)`}
                        >
                          <Icon as={feature.icon} boxSize={20} color={feature.color} opacity={0.8} />
                        </Flex>
                      )}
                    </Box>
                  </Flex>
                </MotionFlex>
              ))}
            </MotionFlex>
          </VStack>
        </Container>
      </Box>
      
      {/* Advanced Features Section */}
      <Box py="80px" bg={useColorModeValue('blue.50', 'gray.800')}>
        <Container maxW="container.xl">
          <VStack gap={16}>
            <VStack gap={3} textAlign="center">
              <Heading
                fontSize={{ base: '3xl', md: '4xl' }}
                fontWeight="bold"
              >
                Advanced Capabilities
              </Heading>
              <Text fontSize={{ base: "lg", md: "xl" }} color={subtitleColor} maxW="700px">
                Take your talent acquisition to the next level with these powerful features
              </Text>
            </VStack>
            
            <MotionSimpleGrid
              columns={{ base: 1, md: 2, lg: 4 }}
              gap={8}
              variants={containerVariants}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: false, amount: 0.2 }}
              w="100%"
            >
              {advancedFeatures.map((feature) => (
                <MotionBox
                  key={feature.title}
                  variants={itemVariants}
                >
                  <Flex
                    direction="column"
                    bg={cardBg}
                    borderRadius="xl"
                    borderWidth="1px"
                    borderColor={cardBorder}
                    overflow="hidden"
                    height="100%"
                    transition="all 0.3s"
                    _hover={{ 
                      transform: "translateY(-8px)", 
                      boxShadow: "xl",
                      borderColor: feature.color
                    }}
                  >
                    <Flex
                      h="120px"
                      align="center"
                      justify="center"
                      bgImage={`linear-gradient(to right, ${feature.color}20, ${feature.color}10)`}
                    >
                      <Icon as={feature.icon} boxSize={14} color={feature.color} />
                    </Flex>
                    
                    <Box p={6}>
                      <Heading size="md" mb={3} fontWeight="bold">
                        {feature.title}
                      </Heading>
                      <Text color={subtitleColor}>
                        {feature.description}
                      </Text>
                    </Box>
                  </Flex>
                </MotionBox>
              ))}
            </MotionSimpleGrid>
          </VStack>
        </Container>
      </Box>
      
      {/* Benefit Section */}
      <Box py="80px" bg={bgColor}>
        <Container maxW="container.xl">
          <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap={12} alignItems="center">
            <GridItem>
              <Heading
                mb={6}
                fontSize={{ base: '2xl', md: '3xl' }}
                fontWeight="bold"
              >
                Why Teams Choose{" "}
                <Box as="span" color={accentBlue}>
                  RoleMatch
                </Box>
              </Heading>
              
              <Text fontSize="lg" color={subtitleColor} mb={8}>
                Organizations that implement RoleMatch see immediate improvements in their hiring metrics
                and candidate quality. Our platform delivers measurable results from day one.
              </Text>
              
              <Grid templateColumns={{ base: "1fr", md: "1fr 1fr" }} gap={6}>
                {benefitsList.map((benefit, i) => (
                  <HStack key={i} align="flex-start">
                    <Flex
                      minW="32px"
                      h="32px"
                      align="center"
                      justify="center"
                      borderRadius="full"
                      bg={accentColor}
                      color="white"
                      mr={3}
                      mt={1}
                    >
                      <Icon as={FiThumbsUp} boxSize={4} />
                    </Flex>
                    <Text fontWeight="medium">{benefit}</Text>
                  </HStack>
                ))}
              </Grid>
              
              <Button tone="#007BA7"
                mt={8}
                size="lg"
                rightIcon={<FiArrowRight />}
              >
                Request a Demo
              </Button>
            </GridItem>
            
            <GridItem>
              <Box
                borderRadius="2xl"
                overflow="hidden"
                boxShadow="2xl"
                position="relative"
              >
                <Image
                  src="/images/dashboard-preview.png"
                  alt="RoleMatch Dashboard"
                  fallbackSrc="/images/placeholder.svg"
                  width="100%"
                  height="auto"
                />
                
                {/* Stat overlays */}
                <HStack
                  position="absolute"
                  bottom="30px"
                  left="50%"
                  transform="translateX(-50%)"
                  gap={6}
                >
                  {[
                    { label: "Time to Hire", value: "-60%", color: accentBlue },
                    { label: "Quality of Hire", value: "+45%", color: accentGreen },
                    { label: "Cost Savings", value: "+35%", color: accentOrange }
                  ].map((stat, i) => (
                    <Box
                      key={i}
                      bg={cardBg}
                      py={3}
                      px={5}
                      borderRadius="lg"
                      boxShadow="lg"
                      textAlign="center"
                      border="1px solid"
                      borderColor={stat.color}
                    >
                      <Text fontWeight="bold" fontSize="xl" color={stat.color}>
                        {stat.value}
                      </Text>
                      <Text fontSize="sm" color={subtitleColor}>
                        {stat.label}
                      </Text>
                    </Box>
                  ))}
                </HStack>
              </Box>
            </GridItem>
          </Grid>
        </Container>
      </Box>
      
      {/* CTA Section */}
      <Box py="80px" bg={useColorModeValue('gray.100', 'gray.700')}>
        <Container maxW="container.md" textAlign="center">
          <VStack gap={8}>
            <Heading
              as="h2"
              fontSize={{ base: '2xl', md: '3xl' }}
              fontWeight="bold"
              bgImage="linear-gradient(to right, {colors.blue.400}, {colors.purple.500})"
              bgClip="text"
            >
              Ready to Transform Your Hiring Process?
            </Heading>
            
            <Text fontSize="lg" color={subtitleColor} maxW="600px">
              Join hundreds of companies who are already using RoleMatch to find and
              hire the perfect candidates faster and more efficiently.
            </Text>
            
            {/* Side by side where there is room; one above the other on a small phone, so the page never scrolls sideways (layout audit, 11 Nov 2026). */}
            <Stack direction={{ base: "column", sm: "row" }} gap={4} align={{ base: "stretch", sm: "center" }}>
              <Button
                size="lg"
                colorPalette="blue"
                rightIcon={<FiArrowRight />}
                px={8}
              >
                Get Started
              </Button>
              
              <Button size="lg" variant="outline">
                Talk to Sales
              </Button>
            </Stack>
          </VStack>
        </Container>
      </Box>
      
      {/* Feature Demo Video Modal */}
      <Dialog.Root open={isOpen} onOpenChange={(e) => { if (!e.open) onClose(); }} size="4xl">
        <Portal>
        <Dialog.Backdrop bg="blackAlpha.700" backdropFilter="blur(10px)" />
        <Dialog.Positioner>
        <Dialog.Content bg={cardBg} borderRadius="xl" overflow="hidden">
          <DialogHeader borderBottomWidth="1px" borderColor={cardBorder}>
            RoleMatch Features Demo
          </DialogHeader>
          <DialogCloseButton />
          <Dialog.Body p={0}>
            <AspectRatioBox ratio={16 / 9}>
              <Flex align="center" justify="center" w="100%" h="100%" bg="gray.100" color="gray.600" textAlign="center" p={8} role="img" aria-label="Demo video coming soon">
                <Text fontSize="lg" fontWeight="medium">A product demo video is coming soon.</Text>
              </Flex>
            </AspectRatioBox>
          </Dialog.Body>
        </Dialog.Content>
        </Dialog.Positioner>
        </Portal>
      </Dialog.Root>
      
    </Box>
  );
};

// AspectRatioBox for responsive video embed
const AspectRatioBox = ({ ratio, children, ...props }) => {
  return (
    <Box position="relative" {...props}>
      <Box
        position="absolute"
        top="0"
        right="0"
        bottom="0"
        left="0"
        width="100%"
        height="100%"
      >
        {children}
      </Box>
      <Box paddingBottom={`${(1 / ratio) * 100}%`} />
    </Box>
  );
};

export default FeaturesPage;
