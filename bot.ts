import dotenv from "dotenv";
dotenv.config();
import { Bot, Context } from "grammy";
import { StatelessQuestion } from "@grammyjs/stateless-question";
import { PrismaClient } from "@prisma/client";
import { ChatMember, User } from "@grammyjs/types";
import { scheduleJob } from "node-schedule";
import {
	addDays,
	formatRelative,
	isBefore,
	setHours,
	setMinutes,
	setSeconds,
} from "date-fns";
import weighted from "weighted";

const prisma = new PrismaClient();

const bot = new Bot(process.env.BOT_API_KEY as string);

const CUTOFF_TIME = {
	hour: 20,
	minute: 0,
	second: 0,
};

const JOINON_TIME = {
	hour: 8,
	minute: 0,
	second: 0,
};

const cutoffDate = setSeconds(
	setMinutes(setHours(new Date(), CUTOFF_TIME.hour), CUTOFF_TIME.minute),
	CUTOFF_TIME.second
);

const parseChoreName = (messageText?: string) => {
	if (messageText) {
		const tokens = messageText.split(" ");
		if (tokens.length < 2) {
			return undefined;
		}
		return tokens[1].toLowerCase();
	}
};

const sendReminder = (ctx: Context, asignee: ChatMember, choreName: string) => {
	ctx.reply(
		`It's time for [${asignee.user.first_name}](tg://user?id=${asignee.user.id}) to do ${choreName}`,
		{ parse_mode: "MarkdownV2" }
	);

	// set the chore as due till someone replies
	prisma.chore
		.update({
			where: { name: choreName },
			data: { isDue: true },
		})
		.then((chore) => {
			console.log(`${chore.name} is now due.`);
		});
};

const queryChoreName = new StatelessQuestion("choreName", async (ctx) => {
	const name = ctx.message.text;

	if (!name) {
		ctx.reply("Please enter a valid name!");
	} else if (/\s/.test(name)) {
		ctx.reply("A name cannot contain any whitespaces");
	} else {
		try {
			const chore = await prisma.chore.create({
				data: {
					name: (name as string).toLowerCase(),
				},
			});
			ctx.reply(`Created chore: "${chore.name}".`);
		} catch (error) {
			// Error might be duplicate chore name
			// TODO: Parse errors better
			ctx.reply(
				`Error creating chore: "${name}". Try a different name?"`
			);
		}
	}
});

const queryUsers = new StatelessQuestion(
	"usersList",
	async (ctx, choreName) => {
		if (ctx.message.entities) {
			const chore = await prisma.chore.findUnique({
				where: { name: choreName },
			});

			if (!chore) {
				ctx.reply("Chore not found (shouldn't get here)");
				return;
			}

			const tgUsers: User[] = ctx.message.entities
				.filter((entity) => entity.type === "text_mention")
				.map((entity: any) => entity.user)
				.filter((user: User) => !user.is_bot);

			const users = tgUsers.map((users) => {
				return {
					tgId: users.id,
					choreId: chore.id,
				};
			});

			// if we find "me" then we add on their ID
			const sender = ctx.message
				.text!.split(" ")
				.reduce((found, name) => name === "me" || found, false)
				? await ctx.getAuthor()
				: undefined;
			if (sender) {
				users.push({
					tgId: sender.user.id,
					choreId: chore!.id,
				});
			}

			// Clear out whatever was there already
			await prisma.weight.deleteMany({ where: { choreId: chore!.id } });
			// Create new weight entries for the users
			const numWeights = await prisma.weight.createMany({
				data: users,
			});

			ctx.reply(`${numWeights.count} users set for "${chore!.name}"`);
		}
	}
);

bot.use(queryChoreName);
bot.use(queryUsers);

// React to /start command
bot.command("start", (ctx) => ctx.reply("Welcome! Up and running"));

bot.command("newchore", (ctx) => {
	return queryChoreName.replyWithMarkdown(
		ctx,
		`Enter a name for the Chore, i.e. "It's Tanner's turn to do <choreName>!"`
	);
});

bot.command("setusers", async (ctx) => {
	// get the chore name entered
	const choreName = parseChoreName(ctx.message?.text);
	if (!choreName) {
		return ctx.reply("Please also type the name of the chore");
	}
	const chore = await prisma.chore.findFirst({
		where: { name: choreName },
	});
	if (!chore) {
		return ctx.reply("Chore not found");
	}

	return queryUsers.replyWithMarkdown(
		ctx,
		`Mention all the users (space-separated) to be assigned to this chore (this will erase the existing users). Note: type "me" to include yourself.`,
		choreName
	);
});

bot.command("due", async (ctx) => {
	const message = ctx.message!.text;

	// === get the chore name entered
	const choreName = parseChoreName(message);
	if (!choreName) {
		return ctx.reply("Please also type the name of the chore that is due");
	}

	// === validate the chore
	const chore = await prisma.chore.findUnique({
		where: { name: choreName },
	});
	if (chore?.isDue) {
		return ctx.reply("The chore is already due");
	}

	// === get list of weights and users for the chore
	const weights = await prisma.chore
		.findUnique({
			where: { name: choreName },
		})
		.weights();
	if (weights.length < 1) {
		return ctx.reply("No users assigned to this chore");
	}

	// === decide which user to assign the chore to
	const weightVals = weights.map((weight) => weight.value);
	const asigneeWeight = weighted.select(weights, weightVals);
	const asignee = await ctx.getChatMember(asigneeWeight.tgId);

	// === determine when to send the message
	const currentDate = new Date();
	// current time in terms of the cutoffDate's date
	const currentTime = setSeconds(
		setMinutes(
			setHours(new Date(cutoffDate), currentDate.getHours()),
			currentDate.getMinutes()
		),
		currentDate.getSeconds()
	);
	if (isBefore(currentTime, cutoffDate)) {
		// before cutoff, remind immediately
		sendReminder(ctx, asignee, choreName);
	} else {
		// get a date that's tomorrow at the JOINON time
		const scheduleDate = setSeconds(
			setMinutes(
				setHours(addDays(currentDate, 1), JOINON_TIME.hour),
				JOINON_TIME.minute
			),
			JOINON_TIME.second
		);
		scheduleJob(choreName, scheduleDate, () => {
			sendReminder(ctx, asignee, choreName);
		});
		ctx.reply(
			`It's too late\\! Scheduling a reminder ${formatRelative(
				scheduleDate,
				currentDate
			)} for [${asignee.user.first_name}](tg://user?id=${
				asignee.user.id
			})\\.`,
			{ parse_mode: "MarkdownV2" }
		);
	}
});

bot.command("done", async (ctx) => {
	const message = ctx.message!.text;

	// === get the chore name entered
	const choreName = parseChoreName(message);
	if (!choreName) {
		return ctx.reply("Please also type the name of the chore that is done");
	}

	const chore = await prisma.chore.findUnique({ where: { name: choreName } });
	if (!chore) {
		return ctx.reply("Please enter a valid chore name");
	}

	if (!chore.isDue) {
		return ctx.reply("That chore is not due yet");
	}

	await prisma.chore.update({
		where: { id: chore.id },
		data: { isDue: false },
	});
	const doer = (await ctx.getAuthor()).user;
	return ctx.reply(
		`[${doer.first_name}](tg://user?id=${doer.id}) completed the chore: ${choreName}`,
		{ parse_mode: "MarkdownV2" }
	);
});

// bot.on("message", (ctx) => {
// 	const isMention = (ctx.message as any).entities
// 		? (ctx.message as any).entities[0].type === "mention"
// 		: undefined;

// 	if (isMention) {

// 	} else {
// 		// just a normal message
// 	}
// });

prisma.$connect().then(() => {
	console.log("DB Connected");
	console.log("Trying to start bot...");
	bot.start();
});
