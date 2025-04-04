// utils/matchSkills.util.js
export const calculateMatch = (userSkills = [], jobRequirements = []) => {
  if (!userSkills.length || !jobRequirements.length) return 0;
  
  const matchedSkills = jobRequirements.filter(req => 
    userSkills.some(skill => 
      skill.toLowerCase().includes(req.toLowerCase().trim())
    )
  );
  
  return (matchedSkills.length / jobRequirements.length) * 100;
};