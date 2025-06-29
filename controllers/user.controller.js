import { User } from "../models/user.model.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import getDataUri from "../utils/datauri.js";
import cloudinary from "../utils/cloudinary.js";
import { Job } from "../models/job.model.js";
import { Application } from "../models/application.model.js";
import { calculateMatch } from "../utils/matchSkills.util.js";

export const register = async (req, res) => {
  try {
    const { fullname, email, phoneNumber, password, role } = req.body;

    if (!fullname || !email || !phoneNumber || !password || !role) {
      return res.status(400).json({
        message: "Something is missing",
        success: false,
      });
    }
    const file = req.file;
    const fileUri = getDataUri(file);
    const cloudResponse = await cloudinary.uploader.upload(fileUri.content);

    const user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({
        message: "User already exist with this email.",
        success: false,
      });
    }
    const hashedPassword = await bcrypt.hash(password, 10);

    await User.create({
      fullname,
      email,
      phoneNumber,
      password: hashedPassword,
      role,
      profile: {
        profilePhoto: cloudResponse.secure_url,
        autoApply: false,
      },
    });

    return res.status(201).json({
      message: "Account created successfully.",
      success: true,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password || !role) {
      return res.status(400).json({
        message: "Something is missing",
        success: false,
      });
    }
    let user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({
        message: "Incorrect email or password.",
        success: false,
      });
    }
    const isPasswordMatch = await bcrypt.compare(password, user.password);
    if (!isPasswordMatch) {
      return res.status(400).json({
        message: "Incorrect email or password.",
        success: false,
      });
    }
    if (role !== user.role) {
      return res.status(400).json({
        message: "Account doesn't exist with current role.",
        success: false,
      });
    }

    const tokenData = {
      userId: user._id,
    };
    const token = await jwt.sign(tokenData, process.env.SECRET_KEY, {
      expiresIn: "1d",
    });

    user = {
      _id: user._id,
      fullname: user.fullname,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
      profile: user.profile,
    };

    return res
      .status(200)
      .cookie("token", token, {
        maxAge: 1 * 24 * 60 * 60 * 1000,
        httpsOnly: true,
        sameSite: "strict",
      })
      .json({
        message: `Welcome back ${user.fullname}`,
        user,
        success: true,
      });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

export const logout = async (req, res) => {
  try {
    return res.status(200).cookie("token", "", { maxAge: 0 }).json({
      message: "Logged out successfully.",
      success: true,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { fullname, email, phoneNumber, bio, skills, autoApply } = req.body;
    const file = req.file;

    const fileUri = getDataUri(file);
    const cloudResponse = await cloudinary.uploader.upload(fileUri.content);

    let skillsArray;
    if (skills) {
      skillsArray = skills.split(",");
    }
    const userId = req.id;
    let user = await User.findById(userId);

    if (!user) {
      return res.status(400).json({
        message: "User not found.",
        success: false,
      });
    }

    // Check if autoApply is being enabled now (was false, now true)
    const isAutoApplyEnabled = !user.profile.autoApply && autoApply === "true";

    // Update fields
    if (fullname) user.fullname = fullname;
    if (email) user.email = email;
    if (phoneNumber) user.phoneNumber = phoneNumber;
    if (bio) user.profile.bio = bio;
    if (skills) user.profile.skills = skillsArray;
    if (autoApply !== undefined) user.profile.autoApply = autoApply === "true";

    if (cloudResponse) {
      user.profile.resume = cloudResponse.secure_url;
      user.profile.resumeOriginalName = file.originalname;
    }

    await user.save();

    // Auto-apply to matching jobs if:
    // 1. Skills were updated and autoApply is enabled, OR
    // 2. AutoApply was just enabled now
    if (
      (skills && user.profile.autoApply && user.profile.skills?.length > 0) ||
      (isAutoApplyEnabled && user.profile.skills?.length > 0)
    ) {
      const jobs = await Job.find({});
      let autoAppliedCount = 0;

      for (const job of jobs) {
        const matchPercent = calculateMatch(
          user.profile.skills,
          job.requirements
        );
        if (matchPercent >= 70) {
          const existingApplication = await Application.findOne({
            job: job._id,
            applicant: user._id,
          });
          if (!existingApplication) {
            const newApplication = await Application.create({
              job: job._id,
              applicant: user._id,
              status: "pending",
              isAutoApplied: true,
            });
            job.applications.push(newApplication._id);
            await job.save();
            autoAppliedCount++;
          }
        }
      }

      return res.status(200).json({
        message: `Profile updated successfully. ${
          autoAppliedCount > 0
            ? `Auto-applied to ${autoAppliedCount} matching jobs!`
            : ""
        }`,
        user,
        success: true,
      });
    }

    user = {
      _id: user._id,
      fullname: user.fullname,
      email: user.email,
      phoneNumber: user.phoneNumber,
      role: user.role,
      profile: user.profile,
    };

    return res.status(200).json({
      message: "Profile updated successfully.",
      user,
      success: true,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

export const bookmarkJob = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        message: "User not found",
        success: false,
      });
    }

    // Check if job is already bookmarked
    const isBookmarked = user.bookmarkedJobs.includes(jobId);

    if (isBookmarked) {
      // Remove bookmark
      user.bookmarkedJobs = user.bookmarkedJobs.filter(
        (id) => id.toString() !== jobId
      );
      await user.save();

      return res.status(200).json({
        message: "Job removed from bookmarks",
        isBookmarked: false,
        success: true,
      });
    } else {
      // Add bookmark
      user.bookmarkedJobs.push(jobId);
      await user.save();

      return res.status(200).json({
        message: "Job bookmarked successfully",
        isBookmarked: true,
        success: true,
      });
    }
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};

export const getBookmarkedJobs = async (req, res) => {
  try {
    const userId = req.id;

    const user = await User.findById(userId).populate("bookmarkedJobs");
    if (!user) {
      return res.status(404).json({
        message: "User not found",
        success: false,
      });
    }

    return res.status(200).json({
      bookmarkedJobs: user.bookmarkedJobs,
      success: true,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      message: "Internal server error",
      success: false,
    });
  }
};
