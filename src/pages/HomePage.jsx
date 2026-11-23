import Navbar from "../components/Navbar"
import {
  Box,
  Heading,
  Text,
  Stack,
  Container,
  VStack,
  HStack,
  SimpleGrid,
  Grid,
  GridItem,
  Flex,
  Icon,
  Badge,
  VisuallyHidden,
} from '@chakra-ui/react'
import { keyframes } from '@emotion/react'
import { useColorMode, useColorModeValue } from '../theme/color-mode'
import { Button } from '../components/ui/button'
import { FiUpload, FiUsers, FiAward, FiBarChart2, FiCheckCircle, FiSearch, FiStar, FiFileText, FiTrendingUp, FiDollarSign } from 'react-icons/fi'
import Animation from '@/components/Animation'
import { useEffect, useState, useRef } from 'react'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement,
  RadialLinearScale,
  Filler
} from 'chart.js'
import { Bar, Doughnut, Radar } from 'react-chartjs-2'

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement,
  RadialLinearScale,
  Filler
)

// Bounce animation for scroll indicator
const bounce = keyframes`
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
`

// Pulse animation for glow effects
const pulse = keyframes`
  0% { opacity: 0.15; transform: scale(1); }
  50% { opacity: 0.3; transform: scale(1.05); }
  100% { opacity: 0.15; transform: scale(1); }
`

// "Superpower" in flowing colour. It was CSS gradient text (background-clip: text) with a moving background: on iPhone Safari that word got a layer of its
// own, painted over the blurred glows behind it, so it sat in a pale box in light and dark mode (owner, 9 Nov 2026). It is now SVG text with a gradient fill,
// which every browser draws the same way. Screen readers read the word itself.
const SUPERPOWER_COLOURS = ['#FF5E3A', '#FFD700', '#3EB489', '#5D3FD3', '#FF6F61', '#007BA7']
function SuperpowerWord() {
  return (
    <Box as="span" display="block" position="relative" fontSize={{ base: '6xl', md: '8xl' }} fontWeight="extrabold" mt={2}>
      <VisuallyHidden>Superpower</VisuallyHidden>
      {/* The word, unseen, takes exactly the room the text did, so the heading's width, the gradient's width and the spacing are as before. */}
      <Box as="span" visibility="hidden" aria-hidden="true">Superpower</Box>
      <svg aria-hidden="true" focusable="false" width="100%" height="100%" style={{ position: 'absolute', inset: 0, overflow: 'visible' }} data-testid="superpower">
        <defs>
          {/* The colours flow at one steady speed, without end (owner, 12 Nov 2026: "my RoleMatch thing wasn't changing colour for a bit"): one band
              of colours, twice the word's width, repeating (the last colour leads back into the first), slid one whole band to the left in each 14 s,
              so the loop has no seam and no pause. The band is moved as a whole (gradientTransform), in units of the word's own box: moving its two
              ends separately (x1, x2 in percentages) worked in Safari but left Chrome with a gradient of no length, one flat brown (owner, 14 Nov
              2026: "superpower isn't changing colours"). Checked 14 Nov 2026 in a real Chrome window and Safari's engine (headless Chrome does not run these animations). */}
          <linearGradient id="superpower-colours" gradientUnits="objectBoundingBox" x1="0" y1="0" x2="2" y2="0" spreadMethod="repeat">
            {[...SUPERPOWER_COLOURS, SUPERPOWER_COLOURS[0]].map((c, i, all) => <stop key={i} offset={i / (all.length - 1)} stopColor={c} />)}
            <animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="-2 0" dur="14s" repeatCount="indefinite" />
          </linearGradient>
        </defs>
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill="url(#superpower-colours)" style={{ font: 'inherit' }}>Superpower</text>
      </svg>
    </Box>
  )
}

// Score counter animation
const scoreAnimation = keyframes`
  0% { transform: scale(0.8); opacity: 0.3; }
  50% { transform: scale(1.1); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
`

// Color change animation for score ring
const colorPulse = keyframes`
  0% { filter: hue-rotate(0deg); }
  25% { filter: hue-rotate(45deg); }
  50% { filter: hue-rotate(90deg); }
  75% { filter: hue-rotate(180deg); }
  100% { filter: hue-rotate(0deg); }
`

// Animated Skills Gap Analysis Chart component
function AnimatedSkillsGapChart({ accentBlue, accentPurple, cardBg, cardBorder }) {
  const [skillsData, setSkillsData] = useState({
    current: [75, 68, 82, 70, 78],
    required: [85, 80, 75, 90, 85]
  })
  const [highlight, setHighlight] = useState(-1)
  
  // Function to generate random fluctuating data with more variation
  const generateFluctuatingData = (baseValues, maxVariation = 8) => {
    return baseValues.map(value => {
      const fluctuation = Math.floor(Math.random() * maxVariation * 2) - maxVariation
      return Math.min(Math.max(value + fluctuation, 45), 98) // Wider range: 45-98
    })
  }
  
  // Update the chart data at regular intervals
  useEffect(() => {
    const dataInterval = setInterval(() => {
      setSkillsData({
        current: generateFluctuatingData(skillsData.current),
        required: generateFluctuatingData(skillsData.required)
      })
    }, 1500) // Update twice as fast - every 1.5 seconds
    
    // Add a highlight effect that rotates through bars
    const highlightInterval = setInterval(() => {
      setHighlight(prev => (prev >= 4 ? 0 : prev + 1))
    }, 800) // Highlight a different column every 800ms
    
    return () => {
      clearInterval(dataInterval) 
      clearInterval(highlightInterval)
    } // Cleanup on unmount
  }, [skillsData])
  
  return (
    <Box 
      bg={cardBg} 
      p={6} 
      borderRadius="lg" 
      boxShadow="md" 
      borderWidth="1px" 
      borderColor={cardBorder}
      height="100%"
    >
      <VStack gap={4} align="start" height="100%">
        <Heading as="h3" size="md" color={accentPurple}>
          Skills Gap Analysis
        </Heading>
        <Text fontSize="sm">
          Identify skill gaps in your organization and make data-driven decisions for training and hiring.
        </Text>
        <Box w="100%" h="250px" mt={2}>
          <Bar
            data={{
              labels: ['Technical', 'Leadership', 'Communication', 'Problem Solving', 'Adaptability'],
              datasets: [
                {
                  label: 'Current Skills',
                  data: skillsData.current,
                  backgroundColor: accentBlue,
                },
                {
                  label: 'Required Skills',
                  data: skillsData.required,
                  backgroundColor: accentPurple,
                },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              animation: {
                duration: 800, // Faster animation
                easing: 'easeOutCubic',
              },
              plugins: {
                tooltip: {
                  callbacks: {
                    title: function(context) {
                      return context[0].label + ' Skills';
                    },
                    label: function(context) {
                      const value = context.raw;
                      const difference = context.datasetIndex === 0 
                        ? skillsData.required[context.dataIndex] - value
                        : value - skillsData.current[context.dataIndex];
                      return `${context.dataset.label}: ${value}% (Gap: ${difference > 0 ? '+' : ''}${difference}%)`;
                    }
                  }
                },
                legend: {
                  position: 'bottom',
                },
              },
              scales: {
                y: {
                  beginAtZero: true,
                  max: 100,
                  title: {
                    display: true,
                    text: 'Proficiency Level',
                  },
                },
              },
            }}
          />
        </Box>
      </VStack>
    </Box>
  )
}

// Animated Hiring Source Effectiveness Chart component
function AnimatedSourceChart({ accentGreen, cardBg, cardBorder }) {
  const [sourceData, setSourceData] = useState([35, 25, 15, 18, 7])
  const [rotation, setRotation] = useState(0)
  
  // Function to generate random fluctuating data maintaining total of 100%
  const generateFluctuatingSourceData = () => {
    // Create more dramatic random adjustments
    const adjustments = Array(5).fill(0).map(() => Math.floor(Math.random() * 10) - 5) // -5 to +4 range
    
    // Apply adjustments to base values, ensuring minimums are preserved
    let newValues = sourceData.map((value, index) => Math.max(value + adjustments[index], 3))
    
    // Occasionally boost a random category significantly
    if (Math.random() > 0.7) {
      const boostIndex = Math.floor(Math.random() * 5)
      newValues[boostIndex] = Math.min(newValues[boostIndex] + 15, 45) // Dramatic increase
    }
    
    // Normalize to ensure sum is 100
    const sum = newValues.reduce((a, b) => a + b, 0)
    newValues = newValues.map(value => Math.round((value / sum) * 100))
    
    // Adjust the last value to ensure sum is exactly 100
    const newSum = newValues.slice(0, -1).reduce((a, b) => a + b, 0)
    newValues[newValues.length - 1] = 100 - newSum
    
    return newValues
  }
  
  // Update the chart data and rotation at regular intervals
  useEffect(() => {
    // Update data more frequently
    const dataInterval = setInterval(() => {
      setSourceData(generateFluctuatingSourceData())
    }, 2000) // Update every 2 seconds
    
    // Add a slight continuous rotation effect
    const rotationInterval = setInterval(() => {
      setRotation(prev => (prev + 5) % 360)
    }, 100) // Update rotation every 100ms
    
    return () => {
      clearInterval(dataInterval)
      clearInterval(rotationInterval)
    } // Cleanup on unmount
  }, [sourceData])
  
  return (
    <Box 
      bg={cardBg} 
      p={6} 
      borderRadius="lg" 
      boxShadow="md" 
      borderWidth="1px" 
      borderColor={cardBorder}
      height="100%"
    >
      <VStack gap={4} align="start" height="100%">
        <Heading as="h3" size="md" color={accentGreen}>
          Hiring Source Effectiveness
        </Heading>
        <Text fontSize="sm">
          Analyze which recruitment channels deliver the best candidates and optimize your sourcing strategy.
        </Text>
        <Flex w="100%" h="250px" mt={2} justify="center" align="center">
          <Box width="80%" height="80%">
            <Doughnut
              data={{
                labels: ['Employee Referrals', 'Job Boards', 'Social Media', 'Career Site', 'Recruitment Agencies'],
                datasets: [
                  {
                    data: sourceData,
                    backgroundColor: [
                      '#48BB78', // green
                      '#4299E1', // blue
                      '#805AD5', // purple
                      '#F6AD55', // orange
                      '#FC8181', // red
                    ],
                    borderWidth: 1,
                  },
                ],
              }}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                  duration: 700, // Faster animation
                  animateRotate: true,
                  animateScale: true,
                },
                rotation: rotation, // Apply continuous rotation effect
                cutout: `${60 + Math.sin(Date.now() / 1000) * 5}%`, // Pulsing effect on cutout
                plugins: {
                  legend: {
                    position: 'bottom',
                  },
                  tooltip: {
                    callbacks: {
                      label: function(context) {
                        return `${context.label}: ${context.raw}%`;
                      }
                    }
                  }
                },
              }}
            />
          </Box>
        </Flex>
      </VStack>
    </Box>
  )
}

// Animated Candidate Competency Radar Chart component
function AnimatedCompetencyChart({ accentBlue, accentPurple, cardBg, cardBorder }) {
  const [candidateData, setCandidateData] = useState([90, 75, 85, 88, 79, 92])
  const [requirementData, setRequirementData] = useState([85, 80, 80, 85, 75, 85])
  const [scale, setScale] = useState(1)
  
  // Function to generate random fluctuating data with more variation
  const generateFluctuatingData = (baseValues, maxVariation = 7) => {
    return baseValues.map(value => {
      const fluctuation = Math.floor(Math.random() * maxVariation * 2) - maxVariation
      return Math.min(Math.max(value + fluctuation, 65), 98) // Wider range: 65-98
    })
  }
  
  // Random spike in a specific skill area
  const generateSkillSpike = (data) => {
    const newData = [...data]
    const spikeIndex = Math.floor(Math.random() * newData.length)
    newData[spikeIndex] = Math.min(newData[spikeIndex] + 10, 98) // Dramatic increase
    return newData
  }
  
  // Update the chart data at regular intervals with more frequent changes
  useEffect(() => {
    // Update data more frequently
    const dataInterval = setInterval(() => {
      setCandidateData(generateFluctuatingData(candidateData))
      setRequirementData(generateFluctuatingData(requirementData))
    }, 1800) // Update faster - every 1.8 seconds
    
    // Occasionally add a skill spike
    const spikeInterval = setInterval(() => {
      if (Math.random() > 0.6) {
        setCandidateData(prev => generateSkillSpike(prev))
      } else {
        setRequirementData(prev => generateSkillSpike(prev))
      }
    }, 2500) // Check for spike every 2.5 seconds
    
    // Add a subtle breathing effect to the chart
    const scaleInterval = setInterval(() => {
      setScale(prev => 0.97 + Math.sin(Date.now() / 500) * 0.05)
    }, 50) // Smooth scale animation
    
    return () => {
      clearInterval(dataInterval)
      clearInterval(spikeInterval)
      clearInterval(scaleInterval)
    } // Cleanup on unmount
  }, [candidateData, requirementData])
  
  return (
    <Box 
      bg={cardBg} 
      p={6} 
      borderRadius="lg" 
      boxShadow="md" 
      borderWidth="1px" 
      borderColor={cardBorder}
      height="100%"
    >
      <VStack gap={4} align="start" height="100%">
        <Heading as="h3" size="md" color={accentBlue}>
          Candidate Competency Profile
        </Heading>
        <Text fontSize="sm">
          Visualize candidate strengths across key competencies to make more informed hiring decisions.
        </Text>
        <Flex w="100%" h="250px" mt={2} justify="center" align="center">
          <Radar
            data={{
              labels: ['Technical Skills', 'Leadership', 'Team Collaboration', 'Problem Solving', 'Industry Knowledge', 'Communication'],
              datasets: [
                {
                  label: 'Top Candidate',
                  data: candidateData,
                  backgroundColor: 'rgba(93, 63, 211, 0.2)',
                  borderColor: accentPurple,
                  pointBackgroundColor: accentPurple,
                  pointBorderColor: '#fff',
                  pointHoverBackgroundColor: '#fff',
                  pointHoverBorderColor: accentPurple,
                },
                {
                  label: 'Job Requirements',
                  data: requirementData,
                  backgroundColor: 'rgba(0, 123, 167, 0.2)',
                  borderColor: accentBlue,
                  pointBackgroundColor: accentBlue,
                  pointBorderColor: '#fff',
                  pointHoverBackgroundColor: '#fff',
                  pointHoverBorderColor: accentBlue,
                },
              ],
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              animation: {
                duration: 700, // Faster animation
              },
              scale: scale, // Apply breathing effect
              hover: {
                animationDuration: 300, // Fast hover animation
              },
              transitions: {
                active: {
                  animation: {
                    duration: 400,
                  },
                },
              },
              scales: {
                r: {
                  angleLines: {
                    display: true,
                  },
                  suggestedMin: 50,
                  suggestedMax: 100,
                },
              },
              plugins: {
                legend: {
                  position: 'bottom',
                },
              },
            }}
          />
        </Flex>
      </VStack>
    </Box>
  )
}

// Animated score counter component
// Animated bar counter component
function AnimatedBarCounter({ accentBlue, accentPurple, accentGreen, cardBg, cardBorder }) {
  const [values, setValues] = useState([70, 75, 85]);
  const [targetValues, setTargetValues] = useState([75, 80, 90]);
  const [isAnimating, setIsAnimating] = useState(false);
  
  const barColors = [accentBlue, accentPurple, accentGreen];
  const barLabels = ['Technical', 'Cultural', 'Experience'];
  
  // Animation effect to continuously update values
  useEffect(() => {
    const interval = setInterval(() => {
      // Generate new random target values
      const newTargets = values.map((currentValue, i) => {
        const min = Math.max(40, currentValue - 15);
        const max = Math.min(95, currentValue + 15);
        return Math.floor(Math.random() * (max - min)) + min;
      });
      
      setTargetValues(newTargets);
      setIsAnimating(true);
    }, 3000);
    
    return () => clearInterval(interval);
  }, [values]);
  
  // Animation effect to smooth transition to target values
  useEffect(() => {
    if (!isAnimating) return;
    
    const animationFrame = requestAnimationFrame(() => {
      const newValues = values.map((value, i) => {
        // Move 10% of the remaining distance each frame
        const diff = targetValues[i] - value;
        if (Math.abs(diff) < 0.5) {
          return targetValues[i];
        }
        return value + diff * 0.1;
      });
      
      setValues(newValues);
      
      // Check if we've reached all target values
      const allReached = newValues.every((value, i) => 
        Math.abs(value - targetValues[i]) < 0.5
      );
      
      if (allReached) {
        setIsAnimating(false);
      }
    });
    
    return () => cancelAnimationFrame(animationFrame);
  }, [values, targetValues, isAnimating]);
  
  return (
    <Box
      bg={cardBg}
      borderRadius="lg"
      p={3}
      width="100%"
      height="100%"
      display="flex"
      flexDirection="column"
      justifyContent="center"
    >      
      <VStack gap={4} width="100%">
        {barLabels.map((label, index) => (
          <Box key={label} width="100%">
            <Flex justify="space-between" align="center" mb={1}>
              <Text fontSize="xs" fontWeight="medium">{label}</Text>
              <Text 
                fontSize="xs" 
                fontWeight="bold" 
                color={barColors[index]}
              >
                {Math.round(values[index])}%
              </Text>
            </Flex>
            <Box 
              width="100%" 
              height="6px" 
              bg="gray.100" 
              borderRadius="full" 
              overflow="hidden"
              position="relative"
            >
              <Box 
                height="100%" 
                width={`${values[index]}%`} 
                bg={barColors[index]}
                borderRadius="full"
                transition="width 0.1s ease-out"
              />
            </Box>
          </Box>
        ))}
      </VStack>
    </Box>
  );
}

function AnimatedScoreCounter() {
  const cardBg = useColorModeValue('white', 'gray.800');
  // State for the counter and animation
  const [count, setCount] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const [animationId, setAnimationId] = useState(null);
  const countRef = useRef(null);
  const ringRef = useRef(null);
  const containerRef = useRef(null);
  
  // Animation settings
  const targetValue = 85;
  const duration = 2000;
  
  // Define color gradient function
  const getColorForPercentage = (percent) => {
    // Red: #E53E3E, Yellow: #ECC94B, Green: #48BB78
    if (percent < 50) {
      // Blend from red to yellow
      const ratio = percent / 50;
      return interpolateColor('#E53E3E', '#ECC94B', ratio);
    } else {
      // Blend from yellow to green
      const ratio = (percent - 50) / 50;
      return interpolateColor('#ECC94B', '#48BB78', ratio);
    }
  };
  
  // Helper function to interpolate between two colors
  const interpolateColor = (color1, color2, ratio) => {
    // Convert hex to RGB
    const r1 = parseInt(color1.substring(1, 3), 16);
    const g1 = parseInt(color1.substring(3, 5), 16);
    const b1 = parseInt(color1.substring(5, 7), 16);
    
    const r2 = parseInt(color2.substring(1, 3), 16);
    const g2 = parseInt(color2.substring(3, 5), 16);
    const b2 = parseInt(color2.substring(5, 7), 16);
    
    // Interpolate
    const r = Math.round(r1 + (r2 - r1) * ratio);
    const g = Math.round(g1 + (g2 - g1) * ratio);
    const b = Math.round(b1 + (b2 - b1) * ratio);
    
    // Convert back to hex
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };
  
  // Start the animation
  const startAnimation = () => {
    // Reset counter if already running
    if (animationId) {
      cancelAnimationFrame(animationId);
      setCount(0);
    }
    
    const startTime = Date.now();
    const endTime = startTime + duration;
    
    const updateAnimation = () => {
      const now = Date.now();
      const progress = Math.min(1, (now - startTime) / duration);
      const currentCount = Math.floor(progress * targetValue);
      const currentColor = getColorForPercentage(currentCount);
      
      setCount(currentCount);
      
      // Update the progress ring with smooth color transition
      if (ringRef.current) {
        ringRef.current.style.setProperty(
          '--progress', 
          `conic-gradient(from 0deg, ${currentColor} ${currentCount}%, #E2E8F0 0)`
        );
      }
      
      // Update the text color
      if (countRef.current) {
        countRef.current.style.color = currentColor;
      }
      
      if (now < endTime) {
        const id = requestAnimationFrame(updateAnimation);
        setAnimationId(id);
      } else {
        // Set final values
        setCount(targetValue);
        const finalColor = getColorForPercentage(targetValue);
        if (ringRef.current) {
          ringRef.current.style.setProperty(
            '--progress', 
            `conic-gradient(from 0deg, ${finalColor} ${targetValue}%, #E2E8F0 0)`
          );
        }
        if (countRef.current) {
          countRef.current.style.color = finalColor;
        }
      }
    };
    
    const id = requestAnimationFrame(updateAnimation);
    setAnimationId(id);
  };
  
  // Handle mouse enter/leave
  const handleMouseEnter = () => {
    setIsHovering(true);
  };
  
  const handleMouseLeave = () => {
    setIsHovering(false);
  };
  
  // Start animation when hovering
  useEffect(() => {
    if (isHovering) {
      startAnimation();
    }
    
    return () => {
      if (animationId) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [isHovering]);
  
  return (
    <Box 
      position="relative" 
      width="120px" 
      height="120px"
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      cursor="pointer"
      transition="transform 0.3s ease"
      _hover={{ transform: 'scale(1.05)' }}
    >
      <Box
        ref={ringRef}
        position="relative"
        width="120px"
        height="120px"
        borderRadius="full"
        background="linear-gradient(90deg, #E53E3E 0%, #ECC94B 50%, #48BB78 100%)"
        backgroundSize="200% 200%"
        animation={`${colorPulse} 8s infinite ease-in-out`}
        display="flex"
        justifyContent="center"
        alignItems="center"
        boxShadow="lg"
        css={{
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: 'full',
            background: 'var(--progress)',
            mask: 'radial-gradient(transparent 40px, black 41px)',
            WebkitMask: 'radial-gradient(transparent 40px, black 41px)'
          }
        }}
      >
        <Box
          position="absolute"
          width="100px"
          height="100px"
          borderRadius="full"
          bg={cardBg}
          display="flex"
          justifyContent="center"
          alignItems="center"
          flexDirection="column"
          boxShadow="inset 0 0 10px rgba(0,0,0,0.1)"
        >
          <Text
            ref={countRef}
            fontSize="2xl"
            fontWeight="bold"
            color="#E53E3E"
            lineHeight="1"
            transition="color 0.2s ease"
          >
            {count}%
          </Text>
          <Text fontSize="xs" color="gray.500" mt={1}>
            match score
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

// CountUpDisplay component for animated score counter
function CountUpDisplay({ targetValue, duration, color, accentPurple, accentGreen }) {
  const [count, setCount] = useState(0);
  const [currentColor, setCurrentColor] = useState(color);
  const countRef = useRef(null);
  
  useEffect(() => {
    // Animate count from 0 to target value
    const startTime = Date.now();
    const endTime = startTime + duration;
    
    // Color sequence for dynamic effect
    const colors = [color, accentPurple, accentGreen, color];
    let colorIndex = 0;
    
    const updateCount = () => {
      const now = Date.now();
      const progress = Math.min(1, (now - startTime) / duration);
      const currentCount = Math.floor(progress * targetValue);
      
      setCount(currentCount);
      
      // Change color at intervals during the animation
      if (progress > 0 && progress < 1) {
        const newColorIndex = Math.floor(progress * 3);
        if (newColorIndex !== colorIndex) {
          colorIndex = newColorIndex;
          setCurrentColor(colors[colorIndex]);
          
          // Add scale animation when color changes
          if (countRef.current) {
            countRef.current.style.animation = `${scoreAnimation} 0.5s ease-out`;
            setTimeout(() => {
              if (countRef.current) {
                countRef.current.style.animation = '';
              }
            }, 500);
          }
        }
      }
      
      if (now < endTime) {
        requestAnimationFrame(updateCount);
      } else {
        setCount(targetValue);
        setCurrentColor(color);
      }
    };
    
    const animationId = requestAnimationFrame(updateCount);
    
    return () => cancelAnimationFrame(animationId);
  }, [targetValue, duration, color, accentPurple, accentGreen]);
  
  return (
    <Text
      ref={countRef}
      fontSize="2xl"
      fontWeight="bold"
      color={currentColor}
      lineHeight="1"
      transition="color 0.5s ease"
    >
      {count}%
    </Text>
  );
}

export default function HomePage() {
  const { colorMode } = useColorMode()
  const glowColor = useColorModeValue('blue.100', 'blue.700')
  const matchColor = useColorModeValue('#DAA520', '#FFD700')
  const titleColor = useColorModeValue('#333333', 'white')
  
  // Bento grid colors
  const cardBg = useColorModeValue('white', 'gray.800')
  const cardBorder = useColorModeValue('gray.200', 'gray.700')
  const cardHoverBg = useColorModeValue('gray.50', 'gray.700')
  const accentBlue = '#007BA7'
  const accentPurple = '#5D3FD3'
  const accentGreen = '#3EB489'
  const accentOrange = '#FF5E3A'

  return (
    <Box minH="100vh" bg={useColorModeValue('#f7f9fc', '#0a0f1c')} position="relative">
      <Navbar />

      {/* Hero Section */}
      <Box
        minH="100vh"
        display="flex"
        alignItems="center"
        justifyContent="center"
        w="100%"
        px={6}
        position="relative"
        overflow="hidden"
      >
        {/* Fixed background glow */}
        <Box
          position="absolute"
          top="50%"
          left="50%"
          transform="translate(-50%, -50%)"
          width="800px"
          height="800px"
          bg="#007BA7"
          opacity="0.15"
          filter="blur(100px)"
          borderRadius="full"
          zIndex={0}
        />

        {/* Purple glow */}
        <Box
          position="absolute"
          top="40%"
          left="60%"
          width="400px"
          height="400px"
          bg="#5D3FD3"
          opacity="0.1"
          filter="blur(70px)"
          borderRadius="full"
          zIndex={0}
        />

        {/* Green glow */}
        <Box
          position="absolute"
          top="60%"
          left="40%"
          width="400px"
          height="400px"
          bg="#3EB489"
          opacity="0.1"
          filter="blur(70px)"
          borderRadius="full"
          zIndex={0}
        />
        
        <Container maxW="3xl" textAlign="center" position="relative" zIndex={1}>

          {/* Hero Content */}
          <VStack gap={12}>
            <Heading
              as="h1"
              fontWeight="extrabold"
              textAlign="center"
              lineHeight="1.2"
            >
              {/* Title */}
              <Box
                as="span"
                display="block"
                fontSize={{ base: '5xl', md: '7xl' }}
                color={titleColor}
              >
                RoleMatch
              </Box>

              {/* Subheadline */}
              <Box
                as="span"
                display="block"
                fontSize={{ base: 'xl', md: '2xl' }}
                fontWeight="medium"
                fontFamily="heading"
                letterSpacing="widest"
                color="text.secondary"
                opacity={0.8}
                mt={2}
              >
                is your hiring
              </Box>

              {/* Superpower Highlight */}
              <SuperpowerWord />
            </Heading>

            {/* Tagline */}
            <Text
              fontSize={{ base: 'lg', md: 'xl' }}
              lineHeight="tall"
              color="text.secondary"
              maxW="2xl"
            >
              <Box as="span" color="#FF5E3A">Discover</Box>,{' '}
              <Box as="span" color={matchColor}>match</Box>, and{' '}
              <Box as="span" color="#3EB489">hire</Box> the best{' '}
              <Box as="span" color="#5D3FD3">talent</Box> with{' '}
              <Box as="span" color="#FF6F61">AI-powered</Box> insights and{' '}
              <Box as="span" color="#007BA7">beautifully simple workflows</Box>.
            </Text>

            {/* CTA Buttons */}
            <Stack direction={['column', 'row']} gap={6} justify="center">
              <Button
                to="/signup"
                size="lg"
                px={8}
                py={6}
                fontSize="lg"
                fontWeight="bold"
                tone="#007BA7"
              >
                Get Started
              </Button>
              <Button
                size="lg"
                px={8}
                py={6}
                fontSize="lg"
                fontWeight="bold"
                variant="outline"
                borderWidth="2px"
                tone="#007BA7"
              >
                Learn More
              </Button>
            </Stack>

            {/* Scroll cue */}
            <Text
              fontSize="sm"
              mt={8}
              opacity={0.6}
              color="text.secondary"
              animation={`${bounce} 2s infinite`}
            >
              ↓ Scroll to see more
            </Text>
          </VStack>
        </Container>
      </Box>

      {/* Features Bento Grid Section */}
      <Box py={20} px={6} bg={useColorModeValue('white', 'gray.900')}>
        <Container maxW="container.xl">
          <VStack gap={16}>
            {/* Section Heading */}
            <VStack gap={3} textAlign="center" maxW="3xl" mx="auto">
              <Heading
                as="h2"
                fontSize={{ base: '3xl', md: '4xl' }}
                fontWeight="bold"
                color={titleColor}
              >
                Why RoleMatch is <Box as="span" color={accentBlue} display="inline">Different</Box>
              </Heading>
              <Text
                fontSize={{ base: 'lg', md: 'xl' }}
                color={useColorModeValue('gray.600', 'gray.400')}
              >
                Our AI-powered platform transforms how you discover, assess, and hire talent with precision and efficiency.
              </Text>
            </VStack>

            {/* Bento Grid */}
            <Grid
              templateColumns={{ base: "minmax(0, 1fr)", md: "repeat(4, minmax(0, 1fr))" }}
              templateRows={{ base: "auto", md: "repeat(3, auto)" }}
              gap={6}
              w="full"
            >
              {/* 1. Main Feature - AI Matching */}
              <GridItem colSpan={{ base: 1, md: 2 }} rowSpan={{ base: 1, md: 2 }} h="100%">
                <Box
                  h="100%"
                  bg={cardBg}
                  borderRadius="xl"
                  borderWidth="1px"
                  borderColor={cardBorder}
                  overflow="hidden"
                  transition="all 0.3s"
                  _hover={{ boxShadow: "xl", transform: "translateY(-5px)" }}
                  position="relative"
                >
                  <Box p={8} h="100%" display="flex" flexDirection="column">
                    <Flex justify="space-between" align="flex-start" mb={6}>
                      <VStack align="start" gap={1}>
                        <Badge colorPalette="blue" fontSize="sm" px={2} py={1} borderRadius="md">
                          Core Feature
                        </Badge>
                        <Heading as="h3" size="lg" fontWeight="bold" color={accentBlue}>
                          1:1 & 1:Many AI Matching
                        </Heading>
                      </VStack>
                      <Icon as={FiUsers} boxSize={10} color={accentBlue} />
                    </Flex>
                    
                    <Text fontSize="md" mb={4} flex="1">
                      Our proprietary algorithm matches candidates to jobs with unprecedented accuracy.
                      Compare one candidate to one job or instantly match a candidate to thousands of
                      opportunities to find their perfect fit.
                    </Text>
                    
                    <Box mt={4} position="relative" height="240px" width="100%">
                      {/* Animation container */}
                      <Flex justify="center" align="center" height="100%" width="100%">
                        <Box position="relative" width="240px" height="240px">
                          {/* The animation */}
                          <Animation
                            autoplay
                            loop
                            src="/animations/matching.json"
                            style={{ height: '100%', width: '100%' }}
                            
                          />
                          
                          {/* Labels overlaid on the animation */}
                          <Box position="absolute" top="0%" left="50%" transform="translateX(-50%)">
                            <Badge bg="#007BA7" color="white" fontSize="xs" px={3} py={1} borderRadius="md" boxShadow="sm">
                              JOB
                            </Badge>
                          </Box>
                          <Box position="absolute" top="35%" left="15%" transform="translateX(-50%)">
                            <Badge bg="#FF5E3A" color="white" fontSize="xs" px={3} py={1} borderRadius="md" boxShadow="sm">
                              CV 1
                            </Badge>
                          </Box>
                          <Box position="absolute" top="35%" left="85%" transform="translateX(-50%)">
                            <Badge bg="#5D3FD3" color="white" fontSize="xs" px={3} py={1} borderRadius="md" boxShadow="sm">
                              CV 2
                            </Badge>
                          </Box>
                          <Box position="absolute" top="80%" left="30%" transform="translateX(-50%)">
                            <Badge bg="#3EB489" color="white" fontSize="xs" px={3} py={1} borderRadius="md" boxShadow="sm">
                              CV 3
                            </Badge>
                          </Box>
                          <Box position="absolute" top="80%" left="70%" transform="translateX(-50%)">
                            <Badge bg="#FFD700" color="#333" fontSize="xs" px={3} py={1} borderRadius="md" boxShadow="sm">
                              CV 4
                            </Badge>
                          </Box>
                        </Box>
                      </Flex>
                    </Box>
                  </Box>
                </Box>
              </GridItem>

              {/* 2. Upload & Go */}
              <GridItem colSpan={1} rowSpan={1}>
                <Box
                  h="100%"
                  bg={cardBg}
                  borderRadius="xl"
                  borderWidth="1px"
                  borderColor={cardBorder}
                  p={6}
                  transition="all 0.3s"
                  _hover={{ boxShadow: "lg", transform: "translateY(-5px)" }}
                >
                  <Icon as={FiUpload} boxSize={8} color={accentOrange} mb={4} />
                  <Heading as="h3" size="md" mb={3} fontWeight="bold">
                    Upload & Go
                  </Heading>
                  <Text fontSize="sm">
                    Simply upload your CV or job description and our AI does the rest, extracting key skills and requirements automatically.
                  </Text>
                </Box>
              </GridItem>

              {/* 3. Instant Reports */}
              <GridItem colSpan={1} rowSpan={1}>
                <Box
                  h="100%"
                  bg={cardBg}
                  borderRadius="xl"
                  borderWidth="1px"
                  borderColor={cardBorder}
                  p={6}
                  transition="all 0.3s"
                  _hover={{ boxShadow: "lg", transform: "translateY(-5px)" }}
                >
                  <Icon as={FiBarChart2} boxSize={8} color={accentGreen} mb={4} />
                  <Heading as="h3" size="md" mb={3} fontWeight="bold">
                    Instant Reports
                  </Heading>
                  <Text fontSize="sm">
                    Generate comprehensive match reports in seconds, with detailed skill gap analysis and compatibility scores.
                  </Text>
                </Box>
              </GridItem>

              {/* 4. Skill Scoring */}
              <GridItem colSpan={1} rowSpan={1}>
                <Box
                  h="100%"
                  bg={cardBg}
                  borderRadius="xl"
                  borderWidth="1px"
                  borderColor={cardBorder}
                  p={6}
                  transition="all 0.3s"
                  _hover={{ boxShadow: "lg", transform: "translateY(-5px)" }}
                >
                  <Icon as={FiAward} boxSize={8} color={accentPurple} mb={4} />
                  <Heading as="h3" size="md" mb={3} fontWeight="bold">
                    Skill Scoring
                  </Heading>
                  <Text fontSize="sm">
                    Our advanced scoring system evaluates both hard and soft skills, providing a holistic view of each candidate.
                  </Text>
                </Box>
              </GridItem>

              {/* 5. Shortlists */}
              <GridItem colSpan={1} rowSpan={1}>
                <Box
                  h="100%"
                  bg={cardBg}
                  borderRadius="xl"
                  borderWidth="1px"
                  borderColor={cardBorder}
                  p={6}
                  transition="all 0.3s"
                  _hover={{ boxShadow: "lg", transform: "translateY(-5px)" }}
                >
                  <Icon as={FiStar} boxSize={8} color={accentOrange} mb={4} />
                  <Heading as="h3" size="md" mb={3} fontWeight="bold">
                    Smart Shortlists
                  </Heading>
                  <Text fontSize="sm">
                    Create and share curated candidate shortlists with your team, complete with match scores and notes.
                  </Text>
                </Box>
              </GridItem>

              {/* 6. Skill Analysis */}
              <GridItem colSpan={{ base: 1, md: 2 }} rowSpan={1}>
                <Box
                  h="100%"
                  bg={cardBg}
                  borderRadius="xl"
                  borderWidth="1px"
                  borderColor={cardBorder}
                  p={6}
                  transition="all 0.3s"
                  _hover={{ boxShadow: "xl", transform: "translateY(-5px)" }}
                >
                  <Flex direction={{ base: "column", sm: "row" }} align="center" justify="space-between" h="100%">
                    <VStack align="start" gap={4} flex="1">
                      <Icon as={FiBarChart2} boxSize={8} color={accentPurple} />
                      <Heading as="h3" size="md" fontWeight="bold">
                        Skill Analysis
                      </Heading>
                      <Text fontSize="sm">
                        Our advanced scoring system evaluates both hard and soft skills, providing a holistic view of each candidate.
                      </Text>
                    </VStack>
                    <Box position="relative" mt={{ base: 6, sm: 0 }} ml={{ base: 0, sm: 4 }} minW="140px">
                      <AnimatedBarCounter 
                        accentBlue={accentBlue}
                        accentPurple={accentPurple}
                        accentGreen={accentGreen}
                        cardBg={cardBg}
                        cardBorder={cardBorder}
                      />
                    </Box>
                  </Flex>
                </Box>
              </GridItem>

              {/* 7. Match Assessment */}
              <GridItem colSpan={{ base: 1, md: 2 }} rowSpan={1}>
                <Box
                  h="100%"
                  bg={cardBg}
                  borderRadius="xl"
                  borderWidth="1px"
                  borderColor={cardBorder}
                  p={6}
                  transition="all 0.3s"
                  _hover={{ boxShadow: "xl", transform: "translateY(-5px)" }}
                >
                  <Flex direction={{ base: "column", sm: "row" }} align="center" justify="space-between" h="100%">
                    <VStack align="start" gap={4} flex="1">
                      <Icon as={FiAward} boxSize={8} color={accentBlue} />
                      <Heading as="h3" size="md" fontWeight="bold">
                        Match Assessment
                      </Heading>
                      <Text fontSize="sm">
                        View detailed match assessments with skill gap analysis, compatibility scores, and visual indicators of match strength.
                      </Text>
                    </VStack>
                    <Box position="relative" mt={{ base: 6, sm: 0 }} ml={{ base: 0, sm: 4 }} minW="140px">
                        <AnimatedScoreCounter 
                          minValue={60}
                          maxValue={95}
                          animationDuration={3000}
                          pauseDuration={1000}
                          continuous={true}
                        />
                    </Box>
                  </Flex>
                </Box>
              </GridItem>
            </Grid>
          </VStack>
        </Container>
      </Box>

      {/* How RoleMatch Works Section */}
      <Box py={20} px={6} bg={useColorModeValue('#f7f9fc', '#0a0f1c')}>
        <Container maxW="container.xl">
          <VStack gap={16}>
            {/* Section Header */}
            <VStack gap={3} textAlign="center" maxW="3xl" mx="auto">
              <Heading
                as="h2"
                fontSize={{ base: '3xl', md: '4xl' }}
                fontWeight="bold"
                color={titleColor}
              >
                How RoleMatch Works
              </Heading>
              <Text
                fontSize={{ base: 'lg', md: 'xl' }}
                color={useColorModeValue('gray.600', 'gray.400')}
              >
                A simple, powerful workflow that transforms your hiring process
              </Text>
            </VStack>

            {/* Process Steps */}
            <Grid
              templateColumns={{ base: 'minmax(0, 1fr)', md: 'repeat(3, minmax(0, 1fr))' }}
              gap={{ base: 10, md: 8 }}
              w="full"
            >
              {/* Step 1 */}
              <VStack
                gap={6}
                bg={cardBg}
                p={8}
                borderRadius="xl"
                boxShadow="lg"
                position="relative"
                transition="all 0.3s"
                _hover={{ transform: 'translateY(-5px)', boxShadow: 'xl' }}
                h="full"
              >
                {/* Step Number */}
                <Flex
                  position="absolute"
                  top="-20px"
                  left="50%"
                  transform="translateX(-50%)"
                  w="40px"
                  h="40px"
                  bg={accentBlue}
                  color="white"
                  borderRadius="full"
                  align="center"
                  justify="center"
                  fontSize="xl"
                  fontWeight="bold"
                  boxShadow="md"
                >
                  1
                </Flex>

                {/* Icon */}
                <Box
                  bg={useColorModeValue('blue.50', 'blue.900')}
                  p={4}
                  borderRadius="full"
                  color={accentBlue}
                >
                  <Icon as={FiUpload} boxSize={8} />
                </Box>

                {/* Content */}
                <VStack gap={4} align="center" textAlign="center">
                  <Heading as="h3" fontSize="xl" fontWeight="bold">
                    Upload Documents
                  </Heading>
                  <Text color={useColorModeValue('gray.600', 'gray.400')}>
                    Upload CVs and job descriptions through our intuitive interface. Our AI extracts and analyzes key information automatically.
                  </Text>
                </VStack>
              </VStack>

              {/* Step 2 */}
              <VStack
                gap={6}
                bg={cardBg}
                p={8}
                borderRadius="xl"
                boxShadow="lg"
                position="relative"
                transition="all 0.3s"
                _hover={{ transform: 'translateY(-5px)', boxShadow: 'xl' }}
                h="full"
              >
                {/* Step Number */}
                <Flex
                  position="absolute"
                  top="-20px"
                  left="50%"
                  transform="translateX(-50%)"
                  w="40px"
                  h="40px"
                  bg={accentPurple}
                  color="white"
                  borderRadius="full"
                  align="center"
                  justify="center"
                  fontSize="xl"
                  fontWeight="bold"
                  boxShadow="md"
                >
                  2
                </Flex>

                {/* Icon */}
                <Box
                  bg={useColorModeValue('purple.50', 'purple.900')}
                  p={4}
                  borderRadius="full"
                  color={accentPurple}
                >
                  <Icon as={FiCheckCircle} boxSize={8} />
                </Box>

                {/* Content */}
                <VStack gap={4} align="center" textAlign="center">
                  <Heading as="h3" fontSize="xl" fontWeight="bold">
                    Match & Analyze
                  </Heading>
                  <Text color={useColorModeValue('gray.600', 'gray.400')}>
                    Our AI engine performs sophisticated matching, comparing skills, experience, and cultural fit to find the perfect candidates.
                  </Text>
                </VStack>
              </VStack>

              {/* Step 3 */}
              <VStack
                gap={6}
                bg={cardBg}
                p={8}
                borderRadius="xl"
                boxShadow="lg"
                position="relative"
                transition="all 0.3s"
                _hover={{ transform: 'translateY(-5px)', boxShadow: 'xl' }}
                h="full"
              >
                {/* Step Number */}
                <Flex
                  position="absolute"
                  top="-20px"
                  left="50%"
                  transform="translateX(-50%)"
                  w="40px"
                  h="40px"
                  bg={accentGreen}
                  color="white"
                  borderRadius="full"
                  align="center"
                  justify="center"
                  fontSize="xl"
                  fontWeight="bold"
                  boxShadow="md"
                >
                  3
                </Flex>

                {/* Icon */}
                <Box
                  bg={useColorModeValue('green.50', 'green.900')}
                  p={4}
                  borderRadius="full"
                  color={accentGreen}
                >
                  <Icon as={FiFileText} boxSize={8} />
                </Box>

                {/* Content */}
                <VStack gap={4} align="center" textAlign="center">
                  <Heading as="h3" fontSize="xl" fontWeight="bold">
                    Review & Decide
                  </Heading>
                  <Text color={useColorModeValue('gray.600', 'gray.400')}>
                    Review detailed match reports, create shortlists, and make data-driven hiring decisions with confidence.
                  </Text>
                </VStack>
              </VStack>
            </Grid>

            {/* CTA Button */}
            <Box mt={10} textAlign="center">
              <Button
                to="/overview"
                size="lg"
                px={10}
                py={7}
                fontSize="md"
                fontWeight="bold"
                tone="#007BA7"
                leftIcon={<Icon as={FiSearch} />}
              >
                Try RoleMatch Now
              </Button>
            </Box>
          </VStack>
        </Container>
      </Box>

      {/* Talent Mobility Section */}
      <Box py={20} px={6} bg={useColorModeValue('white', 'gray.900')}>
        <Container maxW="container.xl">
          <Flex
            direction={{ base: "column", lg: "row" }}
            align="stretch"
            justify="space-between"
            gap={10}
          >
            {/* Left Content */}
            <VStack gap={8} align="start" flex="1" maxW={{ lg: "550px" }} justifyContent="space-between">
              <VStack gap={3} align="start" maxW="lg">
                <Text
                  color={accentPurple}
                  fontWeight="bold"
                  fontSize="lg"
                  letterSpacing="wider"
                >
                  INTERNAL TALENT MOBILITY
                </Text>
                <Heading
                  as="h2"
                  fontSize={{ base: '3xl', md: '4xl' }}
                  fontWeight="bold"
                  lineHeight="1.2"
                  textAlign="left"
                >
                  Unlock Your Organization's
                  <Box as="span" display="block" color={accentBlue}>
                    Hidden Talent
                  </Box>
                </Heading>
                <Text 
                  fontSize={{ base: 'md', md: 'lg' }}
                  color={useColorModeValue('gray.600', 'gray.400')}
                >
                  RoleMatch revolutionizes internal mobility by instantly matching employees to open positions across your entire organization. Identify perfect-fit candidates for new roles in seconds, not weeks.
                </Text>
              </VStack>
              
              <Grid templateColumns={{ base: "minmax(0, 1fr)", md: "repeat(2, minmax(0, 1fr))" }} gap={6} w="full">
                {/* Retain Top Talent Card */}
                <Box
                  position="relative"
                  minH="160px"
                  style={{ perspective: "1000px" }}
                  cursor="pointer"
                  className="flip-card-container"
                  _hover={{
                    "& .flip-card-inner": {
                      transform: "rotateY(180deg)"
                    }
                  }}
                >
                  <Box
                    className="flip-card-inner"
                    position="relative"
                    display="grid"
                    h="100%"
                    transition="transform 0.6s"
                    style={{ transformStyle: "preserve-3d" }}
                  >
                    {/* Front Side */}
                    <Box
                      className="flip-card-front"
                      gridArea="1 / 1"
                      style={{ backfaceVisibility: "hidden" }}
                      p={5}
                      bg={cardBg}
                      borderRadius="lg"
                      borderWidth="1px"
                      borderColor={cardBorder}
                      boxShadow="md"
                    >
                      <Flex align="center" mb={3}>
                        <Box
                          bg={accentPurple}
                          p={2}
                          borderRadius="md"
                          mr={3}
                          color="white"
                        >
                          <Icon as={FiUsers} boxSize={5} />
                        </Box>
                        <Text fontWeight="bold">Retain Top Talent</Text>
                      </Flex>
                      <Text fontSize="sm">
                        Keep your best employees by showing them growth opportunities within your organization.
                      </Text>
                    </Box>
                    
                    {/* Back Side */}
                    <Box
                      className="flip-card-back"
                      gridArea="1 / 1"
                      style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                      bg={accentPurple}
                      color="white"
                      borderRadius="lg"
                      p={5}
                      display="flex"
                      flexDirection="column"
                      justifyContent="center"
                      alignItems="center"
                      textAlign="center"
                      boxShadow="md"
                    >
                      <Text fontWeight="bold" fontSize="md" mb={2}>
                        Why It Matters
                      </Text>
                      <Text fontSize="sm">
                        Reduce turnover by up to 50% by providing clear internal growth paths for your top performers.
                      </Text>
                    </Box>
                  </Box>
                </Box>
                
                {/* Skills Gap Analysis Card */}
                <Box
                  position="relative"
                  minH="160px"
                  style={{ perspective: "1000px" }}
                  cursor="pointer"
                  className="flip-card-container"
                  _hover={{
                    "& .flip-card-inner": {
                      transform: "rotateY(180deg)"
                    }
                  }}
                >
                  <Box
                    className="flip-card-inner"
                    position="relative"
                    display="grid"
                    h="100%"
                    transition="transform 0.6s"
                    style={{ transformStyle: "preserve-3d" }}
                  >
                    {/* Front Side */}
                    <Box
                      className="flip-card-front"
                      gridArea="1 / 1"
                      style={{ backfaceVisibility: "hidden" }}
                      p={5}
                      bg={cardBg}
                      borderRadius="lg"
                      borderWidth="1px"
                      borderColor={cardBorder}
                      boxShadow="md"
                    >
                      <Flex align="center" mb={3}>
                        <Box
                          bg={accentGreen}
                          p={2}
                          borderRadius="md"
                          mr={3}
                          color="white"
                        >
                          <Icon as={FiBarChart2} boxSize={5} />
                        </Box>
                        <Text fontWeight="bold">Skills Gap Analysis</Text>
                      </Flex>
                      <Text fontSize="sm">
                        Identify training needs to prepare employees for their next internal role.
                      </Text>
                    </Box>
                    
                    {/* Back Side */}
                    <Box
                      className="flip-card-back"
                      gridArea="1 / 1"
                      style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                      bg={accentGreen}
                      color="white"
                      borderRadius="lg"
                      p={5}
                      display="flex"
                      flexDirection="column"
                      justifyContent="center"
                      alignItems="center"
                      textAlign="center"
                      boxShadow="md"
                    >
                      <Text fontWeight="bold" fontSize="md" mb={2}>
                        Why It Matters
                      </Text>
                      <Text fontSize="sm">
                        Targeted training reduces time-to-productivity by 40% when employees transition to new roles.
                      </Text>
                    </Box>
                  </Box>
                </Box>
                
                {/* One-to-Many Matching Card */}
                <Box
                  position="relative"
                  minH="160px"
                  style={{ perspective: "1000px" }}
                  cursor="pointer"
                  className="flip-card-container"
                  _hover={{
                    "& .flip-card-inner": {
                      transform: "rotateY(180deg)"
                    }
                  }}
                >
                  <Box
                    className="flip-card-inner"
                    position="relative"
                    display="grid"
                    h="100%"
                    transition="transform 0.6s"
                    style={{ transformStyle: "preserve-3d" }}
                  >
                    {/* Front Side */}
                    <Box
                      className="flip-card-front"
                      gridArea="1 / 1"
                      style={{ backfaceVisibility: "hidden" }}
                      p={5}
                      bg={cardBg}
                      borderRadius="lg"
                      borderWidth="1px"
                      borderColor={cardBorder}
                      boxShadow="md"
                    >
                      <Flex align="center" mb={3}>
                        <Box
                          bg={accentOrange}
                          p={2}
                          borderRadius="md"
                          mr={3}
                          color="white"
                        >
                          <Icon as={FiCheckCircle} boxSize={5} />
                        </Box>
                        <Text fontWeight="bold">One-to-Many Matching</Text>
                      </Flex>
                      <Text fontSize="sm" lineHeight="1.4">
                        Match one employee to multiple positions or one position to multiple employees.
                      </Text>
                    </Box>
                    
                    {/* Back Side */}
                    <Box
                      className="flip-card-back"
                      gridArea="1 / 1"
                      style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                      bg={accentOrange}
                      color="white"
                      borderRadius="lg"
                      p={5}
                      display="flex"
                      flexDirection="column"
                      justifyContent="center"
                      alignItems="center"
                      textAlign="center"
                      boxShadow="md"
                    >
                      <Text fontWeight="bold" fontSize="md" mb={2}>
                        Why It Matters
                      </Text>
                      <Text fontSize="sm">
                        Find the perfect fit 5x faster by simultaneously evaluating multiple role matches for each employee.
                      </Text>
                    </Box>
                  </Box>
                </Box>
                
                {/* Career Pathing Card */}
                <Box
                  position="relative"
                  minH="160px"
                  style={{ perspective: "1000px" }}
                  cursor="pointer"
                  className="flip-card-container"
                  _hover={{
                    "& .flip-card-inner": {
                      transform: "rotateY(180deg)"
                    }
                  }}
                >
                  <Box
                    className="flip-card-inner"
                    position="relative"
                    display="grid"
                    h="100%"
                    transition="transform 0.6s"
                    style={{ transformStyle: "preserve-3d" }}
                  >
                    {/* Front Side */}
                    <Box
                      className="flip-card-front"
                      gridArea="1 / 1"
                      style={{ backfaceVisibility: "hidden" }}
                      p={5}
                      bg={cardBg}
                      borderRadius="lg"
                      borderWidth="1px"
                      borderColor={cardBorder}
                      boxShadow="md"
                    >
                      <Flex align="center" mb={3}>
                        <Box
                          bg={accentBlue}
                          p={2}
                          borderRadius="md"
                          mr={3}
                          color="white"
                        >
                          <Icon as={FiStar} boxSize={5} />
                        </Box>
                        <Text fontWeight="bold">Career Pathing</Text>
                      </Flex>
                      <Text fontSize="sm">
                        Help employees visualize potential career paths within your organization.
                      </Text>
                    </Box>
                    
                    {/* Back Side */}
                    <Box
                      className="flip-card-back"
                      gridArea="1 / 1"
                      style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
                      bg={accentBlue}
                      color="white"
                      borderRadius="lg"
                      p={5}
                      display="flex"
                      flexDirection="column"
                      justifyContent="center"
                      alignItems="center"
                      textAlign="center"
                      boxShadow="md"
                    >
                      <Text fontWeight="bold" fontSize="md" mb={2}>
                        Why It Matters
                      </Text>
                      <Text fontSize="sm">
                        Employees with clear career paths are 3x more engaged and 2x more likely to stay long-term.
                      </Text>
                    </Box>
                  </Box>
                </Box>
              </Grid>
              
              <Flex justify="center" mt={10}>
                <Button to="/features" leftIcon={<FiUsers />} size="lg" tone="#007BA7" px={8}>
                  Explore Talent Mobility
                </Button>
              </Flex>
            </VStack>
            
            {/* Right Animation */}
            <Box
              flex="1"
              position="relative"
              height={{ base: "500px", lg: "auto" }}
              width="100%"
              maxW={{ base: "100%", lg: "650px" }}
              borderRadius="xl"
              overflow="hidden"
              display="flex"
              alignItems="flex-end"
              justifyContent="center"
              ml={{ base: 0, lg: 6 }}
              alignSelf="stretch"
            >
              {/* Animation container with overlay elements - adjusted size */}
              <Box
                width="100%"
                height="90%"
                position="relative"
                mb={4}
              >
                <Animation
                  autoplay
                  loop
                  speed={0.7} /* Slow down the animation */
                  src="/animations/mobility.json"
                  style={{ height: '100%', width: '100%' }}
                />
                
                {/* Overlay Elements: scattered around the animation where there is room for them; a phone gets them as a row below it */}
                <Box
                  display={{ base: 'none', md: 'block' }}
                  position="absolute"
                  top={0}
                  left={0}
                  right={0}
                  bottom={0}
                  pointerEvents="none"
                >
                  {/* Center Employee Profile */}
                  <Badge
                    position="absolute"
                    top="50%"
                    left="50%"
                    transform="translate(-50%, -50%)"
                    bg={accentPurple}
                    color="white"
                    fontSize="sm"
                    px={3}
                    py={1}
                    borderRadius="md"
                    boxShadow="md"
                    zIndex={10}
                  >
                    Employee Profile
                  </Badge>
                  
                  {/* Left column roles */}
                  <VStack
                    position="absolute"
                    top={{ base: "4%", md: "20%" }}
                    left={{ base: "2%", md: "10%" }}
                    gap={{ base: 2, md: 4 }}
                    align="start"
                  >
                    <Badge
                      bg={accentBlue} /* #007BA7 - RoleMatch blue */
                      color="white"
                      fontSize="xs"
                      px={2}
                      py={1}
                      borderRadius="md"
                      boxShadow="md"
                    >
                      Finance Director
                    </Badge>
                    
                    <Badge
                      bg={accentPurple} /* #5D3FD3 - RoleMatch purple */
                      color="white"
                      fontSize="xs"
                      px={2}
                      py={1}
                      borderRadius="md"
                      boxShadow="md"
                    >
                      Marketing Manager
                    </Badge>
                  </VStack>
                  
                  {/* Right column roles */}
                  <VStack
                    position="absolute"
                    top={{ base: "4%", md: "20%" }}
                    right={{ base: "2%", md: "10%" }}
                    gap={{ base: 2, md: 4 }}
                    align="end"
                  >
                    <Badge
                      bg={accentGreen} /* #3EB489 - RoleMatch green */
                      color="white"
                      fontSize="xs"
                      px={2}
                      py={1}
                      borderRadius="md"
                      boxShadow="md"
                    >
                      IT Project Manager
                    </Badge>
                    
                    <Badge
                      bg={accentOrange} /* #FF5E3A - RoleMatch orange */
                      color="white"
                      fontSize="xs"
                      px={2}
                      py={1}
                      borderRadius="md"
                      boxShadow="md"
                    >
                      Sales Executive
                    </Badge>
                  </VStack>
                  
                  {/* Bottom left roles */}
                  <VStack
                    position="absolute"
                    bottom={{ base: "4%", md: "20%" }}
                    left={{ base: "2%", md: "15%" }}
                    gap={{ base: 2, md: 4 }}
                    align="start"
                  >
                    <Badge
                      bg="#FFD700" /* RoleMatch gold */
                      color="black"
                      fontSize="xs"
                      px={2}
                      py={1}
                      borderRadius="md"
                      boxShadow="md"
                    >
                      HR Specialist
                    </Badge>
                    
                    <Badge
                      bg={accentBlue} /* #007BA7 - RoleMatch blue */
                      color="white"
                      fontSize="xs"
                      px={2}
                      py={1}
                      borderRadius="md"
                      boxShadow="md"
                    >
                      Data Analyst
                    </Badge>
                  </VStack>
                  
                  {/* Bottom right roles */}
                  <VStack
                    position="absolute"
                    bottom={{ base: "4%", md: "20%" }}
                    right={{ base: "2%", md: "15%" }}
                    gap={{ base: 2, md: 4 }}
                    align="end"
                  >
                    <Badge
                      bg={accentPurple} /* #5D3FD3 - RoleMatch purple */
                      color="white"
                      fontSize="xs"
                      px={2}
                      py={1}
                      borderRadius="md"
                      boxShadow="md"
                    >
                      Operations Director
                    </Badge>
                    
                    <Badge
                      bg={accentGreen} /* #3EB489 - RoleMatch green */
                      color="white"
                      fontSize="xs"
                      px={2}
                      py={1}
                      borderRadius="md"
                      boxShadow="md"
                    >
                      Research Scientist
                    </Badge>
                  </VStack>
                </Box>
              </Box>
            </Box>

            {/* The same roles on a phone: a wrapped, centred row, since the area beside the animation is too small to scatter them without overlaps */}
            <Flex display={{ base: 'flex', md: 'none' }} wrap="wrap" justify="center" gap={2} w="100%" mt={4}>
              {[
                ['Employee Profile', accentPurple, 'white'], ['Finance Director', accentBlue, 'white'], ['Marketing Manager', accentPurple, 'white'],
                ['IT Project Manager', accentGreen, 'white'], ['Sales Executive', accentOrange, 'white'], ['HR Specialist', '#FFD700', 'black'],
                ['Data Analyst', accentBlue, 'white'], ['Operations Director', accentPurple, 'white'], ['Research Scientist', accentGreen, 'white'],
              ].map(([label, bg, color]) => (
                <Badge key={label} bg={bg} color={color} fontSize="xs" px={2} py={1} borderRadius="md" boxShadow="md">{label}</Badge>
              ))}
            </Flex>
          </Flex>
        </Container>
      </Box>

      {/* Data Insights & Reporting Section */}
      <Box as="section" py={20} bg={useColorModeValue('#edf2f7', '#1a202c')} id="data-insights">
        <Container maxW="container.xl">
          <VStack gap={12}>
            <Box textAlign="center" maxW="800px">
              <Heading as="h2" size="xl" mb={4}>
                Data-Driven Talent Decisions
              </Heading>
              <Text fontSize="lg">
                RoleMatch transforms your hiring process with powerful analytics and visualizations.
                Gain actionable insights to make informed decisions and optimize your talent acquisition strategy.
              </Text>
            </Box>
            
            <Grid templateColumns={{ base: "minmax(0, 1fr)", lg: "repeat(3, minmax(0, 1fr))" }} gap={8} w="full">
              {/* Chart 1: Skills Gap Analysis */}
              <GridItem>
                <AnimatedSkillsGapChart 
                  accentBlue={accentBlue} 
                  accentPurple={accentPurple} 
                  cardBg={cardBg} 
                  cardBorder={cardBorder} 
                />
              </GridItem>
              
              {/* Chart 2: Hiring Source Effectiveness */}
              <GridItem>
                <AnimatedSourceChart 
                  accentGreen={accentGreen} 
                  cardBg={cardBg} 
                  cardBorder={cardBorder} 
                />
              </GridItem>
              
              {/* Chart 3: Candidate Competency Radar */}
              <GridItem>
                <AnimatedCompetencyChart 
                  accentBlue={accentBlue} 
                  accentPurple={accentPurple} 
                  cardBg={cardBg} 
                  cardBorder={cardBorder} 
                />
              </GridItem>
            </Grid>
            
            <Box mt={8} textAlign="center">
              <Button
                to="/contact"
                size="lg"
                tone="#007BA7"
                fontWeight="bold"
                px={8}
                py={3}
                h="auto"
                minH="12"
                maxW="100%"
                whiteSpace="normal"
                textAlign="center"
                leftIcon={<Icon as={FiBarChart2} boxSize={5} />}
              >
                Request Demo of Analytics Dashboard
              </Button>
              <Text fontSize="sm" mt={4} color="gray.500">
                See how RoleMatch's analytics can transform your hiring process
              </Text>
            </Box>
          </VStack>
        </Container>
      </Box>

    </Box>
  )
}
