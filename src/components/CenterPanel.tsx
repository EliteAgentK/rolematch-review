import { Box, Text } from "@chakra-ui/react";
import { useColorModeValue } from "../theme/color-mode";
import { keyframes } from "@emotion/react";
import { useState } from "react";
import Animation from '@/components/Animation';
import CandidateDetails from "./CandidateDetails";
import JobDetails from "./JobDetails";
import { useSettings } from "../settings/SettingsContext";
import { Candidate, Job } from "@/types/records";

interface Props {
  selectedCandidate: Candidate | null;
  selectedJob: Job | null;
  onClear: () => void;
  onDrop?: (e: React.DragEvent) => void;
  dropType?: "candidate" | "job";
  onCandidateChange?: (candidate: Candidate) => unknown;   // resolves to null when nothing was saved (cancelled or refused)
  onJobChange?: (job: Job) => unknown;
  onCandidateReview?: () => Promise<void> | void;
  onJobReview?: () => Promise<void> | void;
  onCandidateDelete?: () => Promise<void> | void;
  onJobDelete?: () => Promise<void> | void;
}

export default function CenterPanel({ selectedCandidate, selectedJob, onClear, onDrop, dropType, onCandidateChange, onJobChange, onCandidateReview, onJobReview, onCandidateDelete, onJobDelete }: Props) {
  const { nouns } = useSettings();
  // Consistent color system with other components
  const bgPanel = useColorModeValue("white", "gray.800");
  const borderColor = useColorModeValue("gray.200", "gray.700");
  const hoverBgColor = useColorModeValue("blue.50", "blue.900");
  const hoverBorderColor = useColorModeValue("blue.400", "blue.500");
  const textColor = useColorModeValue("gray.800", "gray.100");
  const accentColor = useColorModeValue("blue.500", "blue.400");
  
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Event handlers for drag and drop
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    // Check if this is a valid drop (item type is different from panel type)
    const dragType = e.dataTransfer.getData("type");
    if ((dragType === "candidate" && dropType === "job") ||
        (dragType === "job" && dropType === "candidate") ||
        !dragType) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (onDrop) {
      onDrop(e);
    }
  };

  return (
    <Box
      bg={isDraggingOver ? hoverBgColor : bgPanel}
      border="1px solid"
      borderColor={isDraggingOver ? hoverBorderColor : borderColor}
      borderRadius="lg"
      p={6}
      boxShadow={isDraggingOver 
        ? `0 0 10px ${hoverBorderColor}` 
        : `0 4px 12px ${useColorModeValue('rgba(0, 0, 0, 0.05)', 'rgba(0, 0, 0, 0.2)')}`
      }
      // Below 1280 px it is its own height; in the four-column board it fills its column to the row's bottom, as the lists do (Dashboard.tsx).
      flex={{ xl: "1 1 0" }}
      css={{ "@media (min-width: 80em)": { contain: "size" } }}
      minH={{ base: "500px", xl: "360px" }}
      maxH={{ base: "calc(100vh - 184px)", xl: "none" }}
      overflowY="auto"
      overflowX="hidden"
      minW={0}
      overflowWrap="anywhere"   // a long e-mail address, link or unbroken word wraps inside the panel instead of running past its edge
      transition="all 0.2s ease"
      transform={isDraggingOver ? "translateY(-2px)" : "none"}
      position="relative"
      _before={isDraggingOver ? {
        content: '""',
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: "lg",
        pointerEvents: "none",
        boxShadow: `inset 0 0 0 2px ${hoverBorderColor}`,
        opacity: 0.7,
        zIndex: 1,
      } : {}}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      data-drop-type={dropType}
    >
      {selectedCandidate ? (
        <CandidateDetails candidate={selectedCandidate} onClose={onClear} onChange={onCandidateChange} onReview={onCandidateReview} onDelete={onCandidateDelete} />
      ) : selectedJob ? (
        <JobDetails job={selectedJob} onClose={onClear} onChange={onJobChange} onReview={onJobReview} onDelete={onJobDelete} />
      ) : (
        <Box 
          textAlign="center" 
          py={12} 
          display="flex" 
          flexDirection="column" 
          justifyContent="center" 
          alignItems="center" 
          height="100%"
        >
          {/* Create the color cycling animation matching RoleMatch logo colors */}
          {(() => {
            const colorCycleAnimation = keyframes`
              0% { color: #0891B2; } /* Blue T */
              16.6% { color: #F97316; } /* Orange a */
              33.2% { color: #65A30D; } /* Green l */
              49.8% { color: #EAB308; } /* Yellow e */
              66.4% { color: #E11D48; } /* Red n */
              83% { color: #262626; } /* Black t */
              100% { color: #0891B2; } /* Back to Blue */
            `;

            return (
              <Box
                display="inline-block"
                position="relative"
                p={8}
                borderRadius="lg"
                bg={useColorModeValue("gray.50", "gray.700")}
                boxShadow="sm"
              >
                <Box mb={7} textAlign="center">
                  <Animation
                    autoplay
                    loop
                    src="/animations/centerpule.json"
                    style={{ height: '120px', width: '120px', margin: '0 auto' }}
                  />
                </Box>
                
                <Box
                  mb={3}
                  css={{
                    animation: `${colorCycleAnimation} 10s infinite ease-in-out`
                  }}
                >
                  <Text 
                    fontSize="xl" 
                    fontWeight="bold"
                    textShadow="0px 0px 2px rgba(0, 0, 0, 0.1)"
                  >
                    {dropType === "candidate" ? `${nouns.candidate.one} Details` : `${nouns.job.one} Details`}
                  </Text>
                </Box>
                <Text 
                  fontSize="md" 
                  color={textColor}
                  opacity={0.9}
                >
                  Select a {dropType === "candidate" ? "candidate" : "job"} to view details
                </Text>
                {dropType && (
                  <Text 
                    mt={4} 
                    fontSize="sm" 
                    color={accentColor}
                    fontStyle="italic"
                  >
                    You can also drag a {dropType === "job" ? nouns.candidate.one.toLowerCase() : nouns.job.one.toLowerCase()} card here to view matching details
                  </Text>
                )}
              </Box>
            );
          })()}
        </Box>
      )}
    </Box>
  );
}
