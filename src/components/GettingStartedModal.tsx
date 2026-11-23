import { 
  Dialog,
  Portal,
  Box, 
  Text, 
  VStack, 
  HStack, 
  Circle,
  Flex
} from "@chakra-ui/react";
import { useColorModeValue } from "../theme/color-mode";
import { Button } from "./ui/button";
import { DialogCloseButton, DialogHeader } from "./ui/dialog";
import { useState } from "react";
import { FiChevronRight, FiXCircle } from "react-icons/fi";
import { motion } from "motion/react";
import BrandName from "./BrandName";

const MotionCircle = motion.create(Circle);

interface Step {
  number: number;
  title: string;
}

interface GettingStartedModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** A hiring manager reads and changes nothing, so the guide does not tell them to do what is refused. */
  readOnly?: boolean;
}

const GettingStartedModal = ({ isOpen, onClose, readOnly }: GettingStartedModalProps) => {
  const [dontShowAgain, setDontShowAgain] = useState(false);
  
  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem("rolematchDontShowTutorial", "true");
    }
    onClose();
  };
  
  const steps: Step[] = readOnly ? [
    { number: 1, title: "The candidates on the left are the ones your recruiters have shortlisted; the roles are on the right" },
    { number: 2, title: "Open a candidate to read their record and their original CV" },
    { number: 3, title: "Select a candidate and a role, then Show saved match to read the assessment a recruiter ran" },
    { number: 4, title: "Settings shows who is on the team and everything that has happened in the portal" },
  ] : [
    {
      number: 1,
      title: "Browse candidates and jobs from their respective panels on the left and right"
    },
    {
      number: 2,
      title: "Drag a candidate onto a job (or vice versa) to see how well they match"
    },
    {
      number: 3,
      title: "Use the Shortlist Matching Zone at the top to match one candidate against many jobs (or vice versa)"
    },
    {
      number: 4,
      title: "Use the search and filters to quickly find specific candidates or jobs"
    }
  ];

  const textColor = useColorModeValue("gray.800", "white");
  const subtitleColor = useColorModeValue("gray.600", "gray.400");
  const stepBgColor = useColorModeValue("blue.500", "blue.400");
  
  return (
    <Dialog.Root 
      open={isOpen} 
      onOpenChange={(e) => { if (!e.open) handleClose(); }} 
      size="md" 
      placement="center"
    >
      <Portal>
      <Dialog.Backdrop backdropFilter="blur(4px)" />
      <Dialog.Positioner>
      <Dialog.Content 
        borderRadius="xl" 
        boxShadow="2xl"
        overflow="hidden"
        p={0}
      >
        <Box 
          w="full" 
          h="6px" 
          background="linear-gradient(90deg, #3182CE 0%, #4FD1C5 50%, #F6AD55 100%)" 
        />
        
        <DialogCloseButton 
          size="sm" 
          color={textColor}
          top={3}
          right={3}
          zIndex={2}
        />
        
        <DialogHeader 
          pt={4} 
          pb={2} 
          fontSize="xl" 
          fontWeight="bold"
          display="flex"
          alignItems="center"
          px={6}
        >
          <Circle 
            size="32px"
            bg="blue.500"
            color="white"
            mr={3}
            fontSize="lg"
          >
            ?
          </Circle>
          <Text>
            Getting Started with{" "}
            <BrandName />
          </Text>
        </DialogHeader>
        
        <Dialog.Body pt={0} pb={6} px={6}>
          <Text 
            fontSize="md" 
            mb={6} 
            fontWeight="medium" 
            color={subtitleColor}
          >
            Welcome to{" "}
            <BrandName />! Here's how to navigate through
            our powerful candidate-job matching platform:
          </Text>
          
          <VStack gap={4} align="stretch" mb={8}>
            {steps.map((step) => (
              <HStack 
                key={step.number} 
                gap={5} 
                align="center"
                transition="all 0.3s"
                _hover={{ transform: "translateX(5px)" }}
              >
                <MotionCircle 
                  size="36px" 
                  bg={stepBgColor}
                  color="white"
                  fontWeight="bold"
                  fontSize="md"
                  whileHover={{ scale: 1.1 }}
                  transition={{ duration: 0.2 }}
                  boxShadow="sm"
                >
                  {step.number}
                </MotionCircle>
                <Text fontSize="md" fontWeight="medium" flex={1}>
                  {step.title}
                </Text>
              </HStack>
            ))}
          </VStack>
          
          <Flex justify="space-between" align="center">
            <Button
              variant="outline"
              onClick={() => setDontShowAgain(!dontShowAgain)}
              size="md"
              fontWeight="medium"
              leftIcon={dontShowAgain ? <FiXCircle /> : undefined}
            >
              Don't Show Again
            </Button>
            
            <Button
              colorPalette="blue"
              size="md"
              rightIcon={<FiChevronRight />}
              onClick={handleClose}
              px={6}
            >
              Get Started
            </Button>
          </Flex>
        </Dialog.Body>
      </Dialog.Content>
      </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
};

export default GettingStartedModal;
